import * as Y from 'yjs';
import { Item, ContentType, Text, XmlElement, UndoManager } from 'yjs';
import { DecorationSet, Decoration } from 'prosemirror-view';
import { PluginKey, Plugin, TextSelection, AllSelection, NodeSelection, Selection } from 'prosemirror-state';
import 'y-protocols/awareness';
import { createMutex } from 'lib0/mutex';
import * as PModel from 'prosemirror-model';
import { Fragment, Node } from 'prosemirror-model';
import * as math from 'lib0/math';
import * as object from 'lib0/object';
import * as set from 'lib0/set';
import { simpleDiff } from 'lib0/diff';
import * as error from 'lib0/error';
import * as random from 'lib0/random';
import * as environment from 'lib0/environment';
import * as dom from 'lib0/dom';
import * as eventloop from 'lib0/eventloop';
import * as map from 'lib0/map';
import * as sha256 from 'lib0/hash/sha256';
import * as buf from 'lib0/buffer';

/**
 * The unique prosemirror plugin key for syncPlugin
 *
 * @public
 */
const ySyncPluginKey = new PluginKey('y-sync');

/**
 * The unique prosemirror plugin key for undoPlugin
 *
 * @public
 */
const yUndoPluginKey = new PluginKey('y-undo');

/**
 * The unique prosemirror plugin key for cursorPlugin
 *
 * @public
 */
const yCursorPluginKey = new PluginKey('yjs-cursor');

/**
 * Custom function to transform sha256 hash to N byte
 *
 * @param {Uint8Array} digest
 */
const _convolute = digest => {
  const N = 6;
  for (let i = N; i < digest.length; i++) {
    digest[i % N] = digest[i % N] ^ digest[i];
  }
  return digest.slice(0, N)
};

/**
 * @param {any} json
 */
const hashOfJSON = (json) => buf.toBase64(_convolute(sha256.digest(buf.encodeAny(json))));

/**
 * @module bindings/prosemirror
 */

/**
 * @typedef {Object} BindingMetadata
 * @property {ProsemirrorMapping} BindingMetadata.mapping
 * @property {Map<import('prosemirror-model').MarkType, boolean>} BindingMetadata.isOMark - is overlapping mark
 */

/**
 * @return BindingMetadata
 */
const createEmptyMeta = () => ({
  mapping: new Map(),
  isOMark: new Map()
});

/**
 * @param {Y.Item} item
 * @param {Y.Snapshot} [snapshot]
 */
const isVisible = (item, snapshot) =>
  snapshot === undefined
    ? !item.deleted
    : (snapshot.sv.has(item.id.client) && /** @type {number} */
      (snapshot.sv.get(item.id.client)) > item.id.clock &&
      !Y.isDeleted(snapshot.ds, item.id));

/**
 * Either a node if type is YXmlElement or an Array of text nodes if YXmlText
 * @typedef {Map<Y.AbstractType<any>, PModel.Node | Array<PModel.Node>>} ProsemirrorMapping
 */

/**
 * @typedef {Object} ColorDef
 * @property {string} ColorDef.light
 * @property {string} ColorDef.dark
 */

/**
 * @typedef {Object} YSyncOpts
 * @property {Array<ColorDef>} [YSyncOpts.colors]
 * @property {Map<string,ColorDef>} [YSyncOpts.colorMapping]
 * @property {Y.PermanentUserData|null} [YSyncOpts.permanentUserData]
 * @property {ProsemirrorMapping} [YSyncOpts.mapping]
 * @property {function} [YSyncOpts.onFirstRender] Fired when the content from Yjs is initially rendered to ProseMirror
 */

/**
 * @type {Array<ColorDef>}
 */
const defaultColors = [{ light: '#ecd44433', dark: '#ecd444' }];

/**
 * @param {Map<string,ColorDef>} colorMapping
 * @param {Array<ColorDef>} colors
 * @param {string} user
 * @return {ColorDef}
 */
const getUserColor = (colorMapping, colors, user) => {
  // @todo do not hit the same color twice if possible
  if (!colorMapping.has(user)) {
    if (colorMapping.size < colors.length) {
      const usedColors = set.create();
      colorMapping.forEach((color) => usedColors.add(color));
      colors = colors.filter((color) => !usedColors.has(color));
    }
    colorMapping.set(user, random.oneOf(colors));
  }
  return /** @type {ColorDef} */ (colorMapping.get(user))
};

/**
 * This plugin listens to changes in prosemirror view and keeps yXmlState and view in sync.
 *
 * This plugin also keeps references to the type and the shared document so other plugins can access it.
 * @param {Y.XmlFragment} yXmlFragment
 * @param {YSyncOpts} opts
 * @return {any} Returns a prosemirror plugin that binds to this type
 */
const ySyncPlugin = (yXmlFragment, {
  colors = defaultColors,
  colorMapping = new Map(),
  permanentUserData = null,
  onFirstRender = () => {},
  mapping
} = {}) => {
  let initialContentChanged = false;
  const binding = new ProsemirrorBinding(yXmlFragment, mapping);
  const plugin = new Plugin({
    props: {
      editable: (state) => {
        const syncState = ySyncPluginKey.getState(state);
        return syncState.snapshot == null && syncState.prevSnapshot == null
      }
    },
    key: ySyncPluginKey,
    state: {
      /**
       * @returns {any}
       */
      init: (_initargs, _state) => {
        return {
          type: yXmlFragment,
          doc: yXmlFragment.doc,
          binding,
          snapshot: null,
          prevSnapshot: null,
          isChangeOrigin: false,
          isUndoRedoOperation: false,
          addToHistory: true,
          colors,
          colorMapping,
          permanentUserData
        }
      },
      apply: (tr, pluginState) => {
        const change = tr.getMeta(ySyncPluginKey);
        if (change !== undefined) {
          pluginState = Object.assign({}, pluginState);
          for (const key in change) {
            pluginState[key] = change[key];
          }
        }
        pluginState.addToHistory = tr.getMeta('addToHistory') !== false;
        // always set isChangeOrigin. If undefined, this is not change origin.
        pluginState.isChangeOrigin = change !== undefined &&
          !!change.isChangeOrigin;
        pluginState.isUndoRedoOperation = change !== undefined && !!change.isChangeOrigin && !!change.isUndoRedoOperation;
        if (binding.prosemirrorView !== null) {
          if (
            change !== undefined &&
            (change.snapshot != null || change.prevSnapshot != null)
          ) {
            // snapshot changed, rerender next
            eventloop.timeout(0, () => {
              if (binding.prosemirrorView == null) {
                return
              }
              if (change.restore == null) {
                binding._renderSnapshot(
                  change.snapshot,
                  change.prevSnapshot,
                  pluginState
                );
              } else {
                binding._renderSnapshot(
                  change.snapshot,
                  change.snapshot,
                  pluginState
                );
                // reset to current prosemirror state
                delete pluginState.restore;
                delete pluginState.snapshot;
                delete pluginState.prevSnapshot;
                binding.mux(() => {
                  binding._prosemirrorChanged(
                    binding.prosemirrorView.state.doc
                  );
                });
              }
            });
          }
        }
        return pluginState
      }
    },
    view: (view) => {
      binding.initView(view);
      if (mapping == null) {
        // force rerender to update the bindings mapping
        binding._forceRerender();
      }
      onFirstRender();
      return {
        update: () => {
          const pluginState = plugin.getState(view.state);
          if (
            pluginState.snapshot == null && pluginState.prevSnapshot == null
          ) {
            if (
              // If the content doesn't change initially, we don't render anything to Yjs
              // If the content was cleared by a user action, we want to catch the change and
              // represent it in Yjs
              initialContentChanged ||
              view.state.doc.content.findDiffStart(
                view.state.doc.type.createAndFill().content
              ) !== null
            ) {
              initialContentChanged = true;
              if (
                pluginState.addToHistory === false &&
                !pluginState.isChangeOrigin
              ) {
                const yUndoPluginState = yUndoPluginKey.getState(view.state);
                /**
                 * @type {Y.UndoManager}
                 */
                const um = yUndoPluginState && yUndoPluginState.undoManager;
                if (um) {
                  um.stopCapturing();
                }
              }
              binding.mux(() => {
                /** @type {Y.Doc} */ (pluginState.doc).transact((tr) => {
                  tr.meta.set('addToHistory', pluginState.addToHistory);
                  binding._prosemirrorChanged(view.state.doc);
                }, ySyncPluginKey);
              });
            }
          }
        },
        destroy: () => {
          binding.destroy();
        }
      }
    }
  });
  return plugin
};

/**
 * @param {import('prosemirror-state').Transaction} tr
 * @param {ReturnType<typeof getRelativeSelection>} relSel
 * @param {ProsemirrorBinding} binding
 */
const restoreRelativeSelection = (tr, relSel, binding) => {
  if (relSel !== null && relSel.anchor !== null && relSel.head !== null) {
    if (relSel.type === 'all') {
      tr.setSelection(new AllSelection(tr.doc));
    } else if (relSel.type === 'node') {
      const anchor = relativePositionToAbsolutePosition(
        binding.doc,
        binding.type,
        relSel.anchor,
        binding.mapping
      );
      // anchor is null when the referenced node was deleted or moved out of
      // binding.type by a remote update; resolving null would throw.
      if (anchor !== null) {
        tr.setSelection(createSafeNodeSelection(tr, anchor));
      }
    } else if (relSel.type === 'nodeRange') {
      const anchor = relativePositionToAbsolutePosition(
        binding.doc,
        binding.type,
        relSel.anchor,
        binding.mapping
      );
      const head = relativePositionToAbsolutePosition(
        binding.doc,
        binding.type,
        relSel.head,
        binding.mapping
      );
      const selection = createSafeNodeRangeSelection(tr, anchor, head, relSel.depth);
      if (selection !== null) {
        tr.setSelection(selection);
      }
    } else {
      const anchor = relativePositionToAbsolutePosition(
        binding.doc,
        binding.type,
        relSel.anchor,
        binding.mapping
      );
      const head = relativePositionToAbsolutePosition(
        binding.doc,
        binding.type,
        relSel.head,
        binding.mapping
      );
      if (anchor !== null && head !== null) {
        tr.setSelection(TextSelection.between(tr.doc.resolve(anchor), tr.doc.resolve(head)));
      }
    }
  }
};

/**
 * @param {import('prosemirror-state').Transaction} tr
 * @param {number} pos
 * @returns {import('prosemirror-state').Selection}
 *
 * Creates a NodeSelection if the position points to a valid node, otherwise
 * creates a TextSelection near the position.
 */
const createSafeNodeSelection = (tr, pos) => {
  const $pos = tr.doc.resolve(pos);
  if ($pos.nodeAfter) {
    return NodeSelection.create(tr.doc, pos)
  } else {
    return TextSelection.near($pos)
  }
};

/**
 * Safely reconstructs a NodeRangeSelection from resolved absolute positions.
 *
 * @param {import('prosemirror-state').Transaction} tr - The transaction whose document provides resolved positions.
 * @param {number|null} anchor - Absolute document position marking the start (boundary) of the node range.
 *        Use `relativePositionToAbsolutePosition` before calling this function.
 * @param {number|null} head - Absolute document position marking the end (boundary) of the node range.
 *        Use `relativePositionToAbsolutePosition` before calling this function.
 * @param {number|undefined} depth - The nesting depth at which the range operates (e.g. 0 for
 *        top-level blocks, 1 for blocks nested inside a wrapper). Passed through to
 *        `Selection.fromJSON`; ignored by `@tiptap/extension-node-range` < v2.29 but
 *        properly stored starting from that version.
 * @returns {import('prosemirror-state').Selection|null} Reconstructed selection, or null if
 *          anchor/head could not be resolved.
 */
const createSafeNodeRangeSelection = (tr, anchor, head, depth) => {
  if (anchor === null || head === null) {
    return null
  }
  const clampedAnchor = Math.min(Math.max(anchor, 0), tr.doc.content.size);
  const clampedHead = Math.min(Math.max(head, 0), tr.doc.content.size);
  try {
    const selection = Selection.fromJSON(tr.doc, {
      type: 'nodeRange',
      anchor: clampedAnchor,
      head: clampedHead,
      depth
    });
    if (!selection.ranges.length) {
      return TextSelection.near(tr.doc.resolve(clampedAnchor))
    }
    return selection
  } catch (e) {
    return TextSelection.near(tr.doc.resolve(clampedAnchor))
  }
};

/**
 * @param {ProsemirrorBinding} pmbinding
 * @param {import('prosemirror-state').EditorState} state
 */
const getRelativeSelection = (pmbinding, state) => {
  const type = /** @type {any} */ (state.selection).jsonID;
  return {
    type,
    // `depth` is only meaningful for NodeRangeSelection; undefined for every other type.
    depth: type === 'nodeRange' ? /** @type {any} */ (state.selection).depth : undefined,
    anchor: absolutePositionToRelativePosition(
      state.selection.anchor,
      pmbinding.type,
      pmbinding.mapping
    ),
    head: absolutePositionToRelativePosition(
      state.selection.head,
      pmbinding.type,
      pmbinding.mapping
    )
  }
};

/**
 * Binding for prosemirror.
 *
 * @protected
 */
class ProsemirrorBinding {
  /**
   * @param {Y.XmlFragment} yXmlFragment The bind source
   * @param {ProsemirrorMapping} mapping
   */
  constructor (yXmlFragment, mapping = new Map()) {
    this.type = yXmlFragment;
    /**
     * this will be set once the view is created
     * @type {any}
     */
    this.prosemirrorView = null;
    this.mux = createMutex();
    this.mapping = mapping;
    /**
     * Is overlapping mark - i.e. mark does not exclude itself.
     *
     * @type {Map<import('prosemirror-model').MarkType, boolean>}
     */
    this.isOMark = new Map();
    this._observeFunction = this._typeChanged.bind(this);
    /**
     * @type {Y.Doc}
     */
    // @ts-ignore
    this.doc = yXmlFragment.doc;
    /**
     * current selection as relative positions in the Yjs model
     */
    this.beforeTransactionSelection = null;
    this.beforeAllTransactions = () => {
      if (this.beforeTransactionSelection === null && this.prosemirrorView != null) {
        this.beforeTransactionSelection = getRelativeSelection(
          this,
          this.prosemirrorView.state
        );
      }
    };
    this.afterAllTransactions = () => {
      this.beforeTransactionSelection = null;
    };
    this._domSelectionInView = null;
  }

  /**
   * Create a transaction for changing the prosemirror state.
   *
   * @returns
   */
  get _tr () {
    return this.prosemirrorView.state.tr.setMeta('addToHistory', false)
  }

  _isLocalCursorInView () {
    if (!this.prosemirrorView.hasFocus()) return false
    if (environment.isBrowser && this._domSelectionInView === null) {
      // Calculate the domSelectionInView and clear by next tick after all events are finished
      eventloop.timeout(0, () => {
        this._domSelectionInView = null;
      });
      this._domSelectionInView = this._isDomSelectionInView();
    }
    return this._domSelectionInView
  }

  _isDomSelectionInView () {
    const selection = this.prosemirrorView._root.getSelection();

    if (selection == null || selection.anchorNode == null) return false

    const range = this.prosemirrorView._root.createRange();
    range.setStart(selection.anchorNode, selection.anchorOffset);
    range.setEnd(selection.focusNode, selection.focusOffset);

    // This is a workaround for an edgecase where getBoundingClientRect will
    // return zero values if the selection is collapsed at the start of a newline
    // see reference here: https://stackoverflow.com/a/59780954
    const rects = range.getClientRects();
    if (rects.length === 0) {
      // probably buggy newline behavior, explicitly select the node contents
      if (range.startContainer && range.collapsed) {
        range.selectNodeContents(range.startContainer);
      }
    }

    const bounding = range.getBoundingClientRect();
    const documentElement = dom.doc.documentElement;

    return bounding.bottom >= 0 && bounding.right >= 0 &&
      bounding.left <=
        (window.innerWidth || documentElement.clientWidth || 0) &&
      bounding.top <= (window.innerHeight || documentElement.clientHeight || 0)
  }

  /**
   * @param {Y.Snapshot} snapshot
   * @param {Y.Snapshot} prevSnapshot
   */
  renderSnapshot (snapshot, prevSnapshot) {
    if (!prevSnapshot) {
      prevSnapshot = Y.createSnapshot(Y.createDeleteSet(), new Map());
    }
    this.prosemirrorView.dispatch(
      this._tr.setMeta(ySyncPluginKey, { snapshot, prevSnapshot })
    );
  }

  unrenderSnapshot () {
    this.mapping.clear();
    this.mux(() => {
      const fragmentContent = this.type.toArray().map((t) =>
        createNodeFromYElement(
          /** @type {Y.XmlElement} */ (t),
          this.prosemirrorView.state.schema,
          this
        )
      ).filter((n) => n !== null);
      // @ts-ignore
      const tr = this._tr.replace(
        0,
        this.prosemirrorView.state.doc.content.size,
        new PModel.Slice(PModel.Fragment.from(fragmentContent), 0, 0)
      );
      tr.setMeta(ySyncPluginKey, { snapshot: null, prevSnapshot: null });
      this.prosemirrorView.dispatch(tr);
    });
  }

  _forceRerender () {
    this.mapping.clear();
    this.mux(() => {
      // If this is a forced rerender, this might neither happen as a pm change nor within a Yjs
      // transaction. Then the "before selection" doesn't exist. In this case, we need to create a
      // relative position before replacing content. Fixes #126
      const sel = this.beforeTransactionSelection !== null ? null : this.prosemirrorView.state.selection;
      const fragmentContent = this.type.toArray().map((t) =>
        createNodeFromYElement(
          /** @type {Y.XmlElement} */ (t),
          this.prosemirrorView.state.schema,
          this
        )
      ).filter((n) => n !== null);
      // @ts-ignore
      const tr = this._tr.replace(
        0,
        this.prosemirrorView.state.doc.content.size,
        new PModel.Slice(PModel.Fragment.from(fragmentContent), 0, 0)
      );
      if (sel) {
        /**
         * If the Prosemirror document we just created from this.type is
         * smaller than the previous document, the selection might be
         * out of bound, which would make Prosemirror throw an error.
         */
        const clampedAnchor = math.min(math.max(sel.anchor, 0), tr.doc.content.size);
        const clampedHead = math.min(math.max(sel.head, 0), tr.doc.content.size);

        tr.setSelection(TextSelection.create(tr.doc, clampedAnchor, clampedHead));
      }
      this.prosemirrorView.dispatch(
        tr.setMeta(ySyncPluginKey, { isChangeOrigin: true, binding: this })
      );
    });
  }

  /**
   * @param {Y.Snapshot|Uint8Array} snapshot
   * @param {Y.Snapshot|Uint8Array} prevSnapshot
   * @param {Object} pluginState
   */
  _renderSnapshot (snapshot, prevSnapshot, pluginState) {
    /**
     * The document that contains the full history of this document.
     * @type {Y.Doc}
     */
    let historyDoc = this.doc;
    let historyType = this.type;
    if (!snapshot) {
      snapshot = Y.snapshot(this.doc);
    }
    if (snapshot instanceof Uint8Array || prevSnapshot instanceof Uint8Array) {
      if (!(snapshot instanceof Uint8Array) || !(prevSnapshot instanceof Uint8Array)) {
        // expected both snapshots to be v2 updates
        error.unexpectedCase();
      }
      historyDoc = new Y.Doc({ gc: false });
      Y.applyUpdateV2(historyDoc, prevSnapshot);
      prevSnapshot = Y.snapshot(historyDoc);
      Y.applyUpdateV2(historyDoc, snapshot);
      snapshot = Y.snapshot(historyDoc);
      if (historyType._item === null) {
        /**
         * If is a root type, we need to find the root key in the initial document
         * and use it to get the history type.
         */
        const rootKey = Array.from(this.doc.share.keys()).find(
          (key) => this.doc.share.get(key) === this.type
        );
        historyType = historyDoc.getXmlFragment(rootKey);
      } else {
        /**
         * If it is a sub type, we use the item id to find the history type.
         */
        const historyStructs =
          historyDoc.store.clients.get(historyType._item.id.client) ?? [];
        const itemIndex = Y.findIndexSS(
          historyStructs,
          historyType._item.id.clock
        );
        const item = /** @type {Y.Item} */ (historyStructs[itemIndex]);
        const content = /** @type {Y.ContentType} */ (item.content);
        historyType = /** @type {Y.XmlFragment} */ (content.type);
      }
    }
    // clear mapping because we are going to rerender
    this.mapping.clear();
    this.mux(() => {
      historyDoc.transact((transaction) => {
        // before rendering, we are going to sanitize ops and split deleted ops
        // if they were deleted by seperate users.
        /**
         * @type {Y.PermanentUserData}
         */
        const pud = pluginState.permanentUserData;
        if (pud) {
          pud.dss.forEach((ds) => {
            Y.iterateDeletedStructs(transaction, ds, (_item) => {});
          });
        }
        /**
         * @param {'removed'|'added'} type
         * @param {Y.ID} id
         */
        const computeYChange = (type, id) => {
          const user = type === 'added'
            ? pud.getUserByClientId(id.client)
            : pud.getUserByDeletedId(id);
          return {
            user,
            type,
            color: getUserColor(
              pluginState.colorMapping,
              pluginState.colors,
              user
            )
          }
        };
        // Create document fragment and render
        const fragmentContent = Y.typeListToArraySnapshot(
          historyType,
          new Y.Snapshot(prevSnapshot.ds, snapshot.sv)
        ).map((t) => {
          if (
            !t._item.deleted || isVisible(t._item, snapshot) ||
            isVisible(t._item, prevSnapshot)
          ) {
            return createNodeFromYElement(
              t,
              this.prosemirrorView.state.schema,
              { mapping: new Map(), isOMark: new Map() },
              snapshot,
              prevSnapshot,
              computeYChange
            )
          } else {
            // No need to render elements that are not visible by either snapshot.
            // If a client adds and deletes content in the same snapshot the element is not visible by either snapshot.
            return null
          }
        }).filter((n) => n !== null);
        // @ts-ignore
        const tr = this._tr.replace(
          0,
          this.prosemirrorView.state.doc.content.size,
          new PModel.Slice(PModel.Fragment.from(fragmentContent), 0, 0)
        );
        this.prosemirrorView.dispatch(
          tr.setMeta(ySyncPluginKey, { isChangeOrigin: true })
        );
      }, ySyncPluginKey);
    });
  }

  /**
   * @param {Array<Y.YEvent<any>>} events
   * @param {Y.Transaction} transaction
   */
  _typeChanged (events, transaction) {
    if (this.prosemirrorView == null) return
    const syncState = ySyncPluginKey.getState(this.prosemirrorView.state);
    if (
      events.length === 0 || syncState.snapshot != null ||
      syncState.prevSnapshot != null
    ) {
      // drop out if snapshot is active
      this.renderSnapshot(syncState.snapshot, syncState.prevSnapshot);
      return
    }
    this.mux(() => {
      /**
       * @param {any} _
       * @param {Y.AbstractType<any>} type
       */
      const delType = (_, type) => this.mapping.delete(type);
      Y.iterateDeletedStructs(
        transaction,
        transaction.deleteSet,
        (struct) => {
          if (struct.constructor === Y.Item) {
            const type = /** @type {Y.ContentType} */ (/** @type {Y.Item} */ (struct).content).type;
            type && this.mapping.delete(type);
          }
        }
      );
      transaction.changed.forEach(delType);
      transaction.changedParentTypes.forEach(delType);
      const fragmentContent = this.type.toArray().map((t) =>
        createNodeIfNotExists(
          /** @type {Y.XmlElement | Y.XmlHook} */ (t),
          this.prosemirrorView.state.schema,
          this
        )
      ).filter((n) => n !== null);
      // @ts-ignore
      let tr = this._tr.replace(
        0,
        this.prosemirrorView.state.doc.content.size,
        new PModel.Slice(PModel.Fragment.from(fragmentContent), 0, 0)
      );
      restoreRelativeSelection(tr, this.beforeTransactionSelection, this);
      tr = tr.setMeta(ySyncPluginKey, { isChangeOrigin: true, isUndoRedoOperation: transaction.origin instanceof Y.UndoManager });
      if (
        this.beforeTransactionSelection !== null && this._isLocalCursorInView()
      ) {
        tr.scrollIntoView();
      }
      this.prosemirrorView.dispatch(tr);
    });
  }

  /**
   * @param {import('prosemirror-model').Node} doc
   */
  _prosemirrorChanged (doc) {
    this.doc.transact(() => {
      updateYFragment(this.doc, this.type, doc, this);
      this.beforeTransactionSelection = getRelativeSelection(
        this,
        this.prosemirrorView.state
      );
    }, ySyncPluginKey);
  }

  /**
   * View is ready to listen to changes. Register observers.
   * @param {any} prosemirrorView
   */
  initView (prosemirrorView) {
    if (this.prosemirrorView != null) this.destroy();
    this.prosemirrorView = prosemirrorView;
    this.doc.on('beforeAllTransactions', this.beforeAllTransactions);
    this.doc.on('afterAllTransactions', this.afterAllTransactions);
    this.type.observeDeep(this._observeFunction);
  }

  destroy () {
    if (this.prosemirrorView == null) return
    this.prosemirrorView = null;
    this.type.unobserveDeep(this._observeFunction);
    this.doc.off('beforeAllTransactions', this.beforeAllTransactions);
    this.doc.off('afterAllTransactions', this.afterAllTransactions);
  }
}

/**
 * @private
 * @param {Y.XmlElement | Y.XmlHook} el
 * @param {PModel.Schema} schema
 * @param {BindingMetadata} meta
 * @param {Y.Snapshot} [snapshot]
 * @param {Y.Snapshot} [prevSnapshot]
 * @param {function('removed' | 'added', Y.ID):any} [computeYChange]
 * @return {PModel.Node | null}
 */
const createNodeIfNotExists = (
  el,
  schema,
  meta,
  snapshot,
  prevSnapshot,
  computeYChange
) => {
  const node = /** @type {PModel.Node} */ (meta.mapping.get(el));
  if (node === undefined) {
    if (el instanceof Y.XmlElement) {
      return createNodeFromYElement(
        el,
        schema,
        meta,
        snapshot,
        prevSnapshot,
        computeYChange
      )
    } else {
      throw error.methodUnimplemented() // we are currently not handling hooks
    }
  }
  return node
};

/**
 * @private
 * @param {Y.XmlElement} el
 * @param {any} schema
 * @param {BindingMetadata} meta
 * @param {Y.Snapshot} [snapshot]
 * @param {Y.Snapshot} [prevSnapshot]
 * @param {function('removed' | 'added', Y.ID):any} [computeYChange]
 * @return {PModel.Node | null} Returns node if node could be created. Otherwise it deletes the yjs type and returns null
 */
const createNodeFromYElement = (
  el,
  schema,
  meta,
  snapshot,
  prevSnapshot,
  computeYChange
) => {
  const children = [];
  /**
   * @param {Y.XmlElement | Y.XmlText} type
   */
  const createChildren = (type) => {
    if (type instanceof Y.XmlElement) {
      const n = createNodeIfNotExists(
        type,
        schema,
        meta,
        snapshot,
        prevSnapshot,
        computeYChange
      );
      if (n !== null) {
        children.push(n);
      }
    } else {
      // If the next ytext exists and was created by us, move the content to the current ytext.
      // This is a fix for #160 -- duplication of characters when two Y.Text exist next to each
      // other.
      const nextytext = /** @type {Y.ContentType} */ (type._item.right?.content)?.type;
      if (nextytext instanceof Y.Text && !nextytext._item.deleted && nextytext._item.id.client === nextytext.doc.clientID) {
        type.applyDelta([
          { retain: type.length },
          ...nextytext.toDelta()
        ]);
        nextytext.doc.transact(tr => {
          nextytext._item.delete(tr);
        });
      }
      // now create the prosemirror text nodes
      const ns = createTextNodesFromYText(
        type,
        schema,
        meta,
        snapshot,
        prevSnapshot,
        computeYChange
      );
      if (ns !== null) {
        ns.forEach((textchild) => {
          if (textchild !== null) {
            children.push(textchild);
          }
        });
      }
    }
  };
  if (snapshot === undefined || prevSnapshot === undefined) {
    el.toArray().forEach(createChildren);
  } else {
    Y.typeListToArraySnapshot(el, new Y.Snapshot(prevSnapshot.ds, snapshot.sv))
      .forEach(createChildren);
  }
  try {
    const attrs = el.getAttributes(snapshot);
    if (snapshot !== undefined) {
      if (!isVisible(/** @type {Y.Item} */ (el._item), snapshot)) {
        attrs.ychange = computeYChange
          ? computeYChange('removed', /** @type {Y.Item} */ (el._item).id)
          : { type: 'removed' };
      } else if (!isVisible(/** @type {Y.Item} */ (el._item), prevSnapshot)) {
        attrs.ychange = computeYChange
          ? computeYChange('added', /** @type {Y.Item} */ (el._item).id)
          : { type: 'added' };
      }
    }
    const node = schema.node(el.nodeName, attrs, children);
    meta.mapping.set(el, node);
    return node
  } catch (e) {
    // an error occured while creating the node. This is probably a result of a concurrent action.
    /** @type {Y.Doc} */ (el.doc).transact((transaction) => {
      /** @type {Y.Item} */ (el._item).delete(transaction);
    }, ySyncPluginKey);
    meta.mapping.delete(el);
    return null
  }
};

/**
 * @private
 * @param {Y.XmlText} text
 * @param {import('prosemirror-model').Schema} schema
 * @param {BindingMetadata} _meta
 * @param {Y.Snapshot} [snapshot]
 * @param {Y.Snapshot} [prevSnapshot]
 * @param {function('removed' | 'added', Y.ID):any} [computeYChange]
 * @return {Array<PModel.Node>|null}
 */
const createTextNodesFromYText = (
  text,
  schema,
  _meta,
  snapshot,
  prevSnapshot,
  computeYChange
) => {
  const nodes = [];
  const deltas = text.toDelta(snapshot, prevSnapshot, computeYChange);
  try {
    for (let i = 0; i < deltas.length; i++) {
      const delta = deltas[i];
      nodes.push(schema.text(delta.insert, attributesToMarks(delta.attributes, schema)));
    }
  } catch (e) {
    // an error occured while creating the node. This is probably a result of a concurrent action.
    /** @type {Y.Doc} */ (text.doc).transact((transaction) => {
      /** @type {Y.Item} */ (text._item).delete(transaction);
    }, ySyncPluginKey);
    return null
  }
  // @ts-ignore
  return nodes
};

/**
 * @private
 * @param {Array<any>} nodes prosemirror node
 * @param {BindingMetadata} meta
 * @return {Y.XmlText}
 */
const createTypeFromTextNodes = (nodes, meta) => {
  const type = new Y.XmlText();
  const delta = nodes.map((node) => ({
    // @ts-ignore
    insert: node.text,
    attributes: marksToAttributes(node.marks, meta)
  }));
  type.applyDelta(delta);
  meta.mapping.set(type, nodes);
  return type
};

/**
 * @private
 * @param {any} node prosemirror node
 * @param {BindingMetadata} meta
 * @return {Y.XmlElement}
 */
const createTypeFromElementNode = (node, meta) => {
  const type = new Y.XmlElement(node.type.name);
  for (const key in node.attrs) {
    const val = node.attrs[key];
    if (val !== null && key !== 'ychange') {
      type.setAttribute(key, val);
    }
  }
  type.insert(
    0,
    normalizePNodeContent(node).map((n) =>
      createTypeFromTextOrElementNode(n, meta)
    )
  );
  meta.mapping.set(type, node);
  return type
};

/**
 * @private
 * @param {PModel.Node|Array<PModel.Node>} node prosemirror text node
 * @param {BindingMetadata} meta
 * @return {Y.XmlElement|Y.XmlText}
 */
const createTypeFromTextOrElementNode = (node, meta) =>
  node instanceof Array
    ? createTypeFromTextNodes(node, meta)
    : createTypeFromElementNode(node, meta);

/**
 * @param {any} val
 */
const isObject = (val) => typeof val === 'object' && val !== null;

/**
 * @param {any} pattrs
 * @param {any} yattrs
 */
const equalAttrs = (pattrs, yattrs) => {
  const keys = Object.keys(pattrs).filter((key) => pattrs[key] !== null);
  let eq =
    keys.length ===
      Object.keys(yattrs).filter((key) => yattrs[key] !== null).length;
  for (let i = 0; i < keys.length && eq; i++) {
    const key = keys[i];
    const l = pattrs[key];
    const r = yattrs[key];
    eq = key === 'ychange' || l === r ||
      (isObject(l) && isObject(r) && equalAttrs(l, r));
  }
  return eq
};

/**
 * @typedef {Array<Array<PModel.Node>|PModel.Node>} NormalizedPNodeContent
 */

/**
 * @param {any} pnode
 * @return {NormalizedPNodeContent}
 */
const normalizePNodeContent = (pnode) => {
  const c = pnode.content.content;
  const res = [];
  for (let i = 0; i < c.length; i++) {
    const n = c[i];
    if (n.isText) {
      const textNodes = [];
      for (let tnode = c[i]; i < c.length && tnode.isText; tnode = c[++i]) {
        textNodes.push(tnode);
      }
      i--;
      res.push(textNodes);
    } else {
      res.push(n);
    }
  }
  return res
};

/**
 * @param {Y.XmlText} ytext
 * @param {Array<any>} ptexts
 */
const equalYTextPText = (ytext, ptexts) => {
  const delta = ytext.toDelta();
  return delta.length === ptexts.length &&
    delta.every(/** @type {(d:any,i:number) => boolean} */ (d, i) =>
      d.insert === /** @type {any} */ (ptexts[i]).text &&
      object.keys(d.attributes || {}).length === ptexts[i].marks.length &&
      object.every(d.attributes, (attr, /** @type {string} */ yattrname) => {
        const markname = yattr2markname(yattrname);
        const pmarks = ptexts[i].marks;

        const pmark = pmarks.find(/** @param {any} mark */ mark => mark.type.name === markname);

        // Ensure the pmark is present in the ptexts before checking equality. When replacing a mark with another mark
        // the pmark will be missing from the ptexts and the equalAttrs will throw an error.
        if (!pmark) {
          return false
        }

        return equalAttrs(attr, pmarks.find(/** @param {any} mark */ mark => mark.type.name === markname)?.attrs)
      })
    )
};

/**
 * @param {Y.XmlElement|Y.XmlText|Y.XmlHook} ytype
 * @param {any|Array<any>} pnode
 */
const equalYTypePNode = (ytype, pnode) => {
  if (
    ytype instanceof Y.XmlElement && !(pnode instanceof Array) &&
    matchNodeName(ytype, pnode)
  ) {
    const normalizedContent = normalizePNodeContent(pnode);
    return ytype._length === normalizedContent.length &&
      equalAttrs(ytype.getAttributes(), pnode.attrs) &&
      ytype.toArray().every((ychild, i) =>
        equalYTypePNode(ychild, normalizedContent[i])
      )
  }
  return ytype instanceof Y.XmlText && pnode instanceof Array &&
    equalYTextPText(ytype, pnode)
};

/**
 * @param {PModel.Node | Array<PModel.Node> | undefined} mapped
 * @param {PModel.Node | Array<PModel.Node>} pcontent
 */
const mappedIdentity = (mapped, pcontent) =>
  mapped === pcontent ||
  (mapped instanceof Array && pcontent instanceof Array &&
    mapped.length === pcontent.length && mapped.every((a, i) =>
    pcontent[i] === a
  ));

/**
 * @param {Y.XmlElement} ytype
 * @param {PModel.Node} pnode
 * @param {BindingMetadata} meta
 * @return {{ foundMappedChild: boolean, equalityFactor: number }}
 */
const computeChildEqualityFactor = (ytype, pnode, meta) => {
  const yChildren = ytype.toArray();
  const pChildren = normalizePNodeContent(pnode);
  const pChildCnt = pChildren.length;
  const yChildCnt = yChildren.length;
  const minCnt = math.min(yChildCnt, pChildCnt);
  let left = 0;
  let right = 0;
  let foundMappedChild = false;
  for (; left < minCnt; left++) {
    const leftY = yChildren[left];
    const leftP = pChildren[left];
    if (mappedIdentity(meta.mapping.get(leftY), leftP)) {
      foundMappedChild = true; // definite (good) match!
    } else if (!equalYTypePNode(leftY, leftP)) {
      break
    }
  }
  for (; left + right < minCnt; right++) {
    const rightY = yChildren[yChildCnt - right - 1];
    const rightP = pChildren[pChildCnt - right - 1];
    if (mappedIdentity(meta.mapping.get(rightY), rightP)) {
      foundMappedChild = true;
    } else if (!equalYTypePNode(rightY, rightP)) {
      break
    }
  }
  return {
    equalityFactor: left + right,
    foundMappedChild
  }
};

/**
 * @param {Y.Text} ytext
 */
const ytextTrans = (ytext) => {
  let str = '';
  /**
   * @type {Y.Item|null}
   */
  let n = ytext._start;
  const nAttrs = {};
  while (n !== null) {
    if (!n.deleted) {
      if (n.countable && n.content instanceof Y.ContentString) {
        str += n.content.str;
      } else if (n.content instanceof Y.ContentFormat) {
        nAttrs[n.content.key] = null;
      }
    }
    n = n.right;
  }
  return {
    str,
    nAttrs
  }
};

/**
 * @todo test this more
 *
 * @param {Y.Text} ytext
 * @param {Array<any>} ptexts
 * @param {BindingMetadata} meta
 */
const updateYText = (ytext, ptexts, meta) => {
  meta.mapping.set(ytext, ptexts);
  const { nAttrs, str } = ytextTrans(ytext);
  const content = ptexts.map((p) => ({
    insert: /** @type {any} */ (p).text,
    attributes: Object.assign({}, nAttrs, marksToAttributes(p.marks, meta))
  }));
  const { insert, remove, index } = simpleDiff(
    str,
    content.map((c) => c.insert).join('')
  );
  ytext.delete(index, remove);
  ytext.insert(index, insert);
  ytext.applyDelta(
    content.map((c) => ({ retain: c.insert.length, attributes: c.attributes }))
  );
};

const hashedMarkNameRegex = /(.*)(--[a-zA-Z0-9+/=]{8})$/;
/**
 * @param {string} attrName
 */
const yattr2markname = attrName => hashedMarkNameRegex.exec(attrName)?.[1] ?? attrName;

/**
 * @todo move this to markstoattributes
 *
 * @param {Object<string, any>} attrs
 * @param {import('prosemirror-model').Schema} schema
 */
const attributesToMarks = (attrs, schema) => {
  /**
   * @type {Array<import('prosemirror-model').Mark>}
   */
  const marks = [];
  for (const markName in attrs) {
    // remove hashes if necessary
    marks.push(schema.mark(yattr2markname(markName), attrs[markName]));
  }
  return marks
};

/**
 * @param {Array<import('prosemirror-model').Mark>} marks
 * @param {BindingMetadata} meta
 */
const marksToAttributes = (marks, meta) => {
  const pattrs = {};
  marks.forEach((mark) => {
    if (mark.type.name !== 'ychange') {
      const isOverlapping = map.setIfUndefined(meta.isOMark, mark.type, () => !mark.type.excludes(mark.type));
      pattrs[isOverlapping ? `${mark.type.name}--${hashOfJSON(mark.toJSON())}` : mark.type.name] = mark.attrs;
    }
  });
  return pattrs
};

/**
 * Update a yDom node by syncing the current content of the prosemirror node.
 *
 * This is a y-prosemirror internal feature that you can use at your own risk.
 *
 * @private
 * @unstable
 *
 * @param {{transact: Function}} y
 * @param {Y.XmlFragment} yDomFragment
 * @param {any} pNode
 * @param {BindingMetadata} meta
 */
const updateYFragment = (y, yDomFragment, pNode, meta) => {
  if (
    yDomFragment instanceof Y.XmlElement &&
    yDomFragment.nodeName !== pNode.type.name
  ) {
    throw new Error('node name mismatch!')
  }
  meta.mapping.set(yDomFragment, pNode);
  // update attributes
  if (yDomFragment instanceof Y.XmlElement) {
    const yDomAttrs = yDomFragment.getAttributes();
    const pAttrs = pNode.attrs;
    for (const key in pAttrs) {
      if (pAttrs[key] !== null) {
        if (yDomAttrs[key] !== pAttrs[key] && key !== 'ychange') {
          yDomFragment.setAttribute(key, pAttrs[key]);
        }
      } else {
        yDomFragment.removeAttribute(key);
      }
    }
    // remove all keys that are no longer in pAttrs
    for (const key in yDomAttrs) {
      if (pAttrs[key] === undefined) {
        yDomFragment.removeAttribute(key);
      }
    }
  }
  // update children
  const pChildren = normalizePNodeContent(pNode);
  const pChildCnt = pChildren.length;
  const yChildren = yDomFragment.toArray();
  const yChildCnt = yChildren.length;
  const minCnt = math.min(pChildCnt, yChildCnt);
  let left = 0;
  let right = 0;
  // find number of matching elements from left
  for (; left < minCnt; left++) {
    const leftY = yChildren[left];
    const leftP = pChildren[left];
    if (!mappedIdentity(meta.mapping.get(leftY), leftP)) {
      if (equalYTypePNode(leftY, leftP)) {
        // update mapping
        meta.mapping.set(leftY, leftP);
      } else {
        break
      }
    }
  }
  // find number of matching elements from right
  for (; right + left + 1 < minCnt; right++) {
    const rightY = yChildren[yChildCnt - right - 1];
    const rightP = pChildren[pChildCnt - right - 1];
    if (!mappedIdentity(meta.mapping.get(rightY), rightP)) {
      if (equalYTypePNode(rightY, rightP)) {
        // update mapping
        meta.mapping.set(rightY, rightP);
      } else {
        break
      }
    }
  }
  y.transact(() => {
    // try to compare and update
    while (yChildCnt - left - right > 0 && pChildCnt - left - right > 0) {
      const leftY = yChildren[left];
      const leftP = pChildren[left];
      const rightY = yChildren[yChildCnt - right - 1];
      const rightP = pChildren[pChildCnt - right - 1];
      if (leftY instanceof Y.XmlText && leftP instanceof Array) {
        if (!equalYTextPText(leftY, leftP)) {
          updateYText(leftY, leftP, meta);
        }
        left += 1;
      } else {
        let updateLeft = leftY instanceof Y.XmlElement &&
          matchNodeName(leftY, leftP);
        let updateRight = rightY instanceof Y.XmlElement &&
          matchNodeName(rightY, rightP);
        if (updateLeft && updateRight) {
          // decide which which element to update
          const equalityLeft = computeChildEqualityFactor(
            /** @type {Y.XmlElement} */ (leftY),
            /** @type {PModel.Node} */ (leftP),
            meta
          );
          const equalityRight = computeChildEqualityFactor(
            /** @type {Y.XmlElement} */ (rightY),
            /** @type {PModel.Node} */ (rightP),
            meta
          );
          if (
            equalityLeft.foundMappedChild && !equalityRight.foundMappedChild
          ) {
            updateRight = false;
          } else if (
            !equalityLeft.foundMappedChild && equalityRight.foundMappedChild
          ) {
            updateLeft = false;
          } else if (
            equalityLeft.equalityFactor < equalityRight.equalityFactor
          ) {
            updateLeft = false;
          } else {
            updateRight = false;
          }
        }
        if (updateLeft) {
          updateYFragment(
            y,
            /** @type {Y.XmlFragment} */ (leftY),
            /** @type {PModel.Node} */ (leftP),
            meta
          );
          left += 1;
        } else if (updateRight) {
          updateYFragment(
            y,
            /** @type {Y.XmlFragment} */ (rightY),
            /** @type {PModel.Node} */ (rightP),
            meta
          );
          right += 1;
        } else {
          meta.mapping.delete(yDomFragment.get(left));
          yDomFragment.delete(left, 1);
          yDomFragment.insert(left, [
            createTypeFromTextOrElementNode(leftP, meta)
          ]);
          left += 1;
        }
      }
    }
    const yDelLen = yChildCnt - left - right;
    if (
      yChildCnt === 1 && pChildCnt === 0 && yChildren[0] instanceof Y.XmlText
    ) {
      meta.mapping.delete(yChildren[0]);
      // Edge case handling https://github.com/yjs/y-prosemirror/issues/108
      // Only delete the content of the Y.Text to retain remote changes on the same Y.Text object
      yChildren[0].delete(0, yChildren[0].length);
    } else if (yDelLen > 0) {
      yDomFragment.slice(left, left + yDelLen).forEach(type => meta.mapping.delete(type));
      yDomFragment.delete(left, yDelLen);
    }
    if (left + right < pChildCnt) {
      const ins = [];
      for (let i = left; i < pChildCnt - right; i++) {
        ins.push(createTypeFromTextOrElementNode(pChildren[i], meta));
      }
      yDomFragment.insert(left, ins);
    }
  }, ySyncPluginKey);
};

/**
 * @function
 * @param {Y.XmlElement} yElement
 * @param {any} pNode Prosemirror Node
 */
const matchNodeName = (yElement, pNode) =>
  !(pNode instanceof Array) && yElement.nodeName === pNode.type.name;

/**
 * Either a node if type is YXmlElement or an Array of text nodes if YXmlText
 * @typedef {Map<Y.AbstractType, Node | Array<Node>>} ProsemirrorMapping
 */

/**
 * Is null if no timeout is in progress.
 * Is defined if a timeout is in progress.
 * Maps from view
 * @type {Map<EditorView, Map<any, any>>|null}
 */
let viewsToUpdate = null;

class MetaEntry {
  /**
   * @param {EditorView} view
   * @param {any} key
   * @param {any} value
   */
  constructor (view, key, value) {
    this.view = view;
    this.key = key;
    this.value = value;
  }

  apply () {
    const syncState = ySyncPluginKey.getState(this.view.state);
    if (syncState && syncState.binding && !syncState.binding.isDestroyed) {
      const tr = this.view.state.tr;
      tr.setMeta(this.key, this.value);
      this.view.dispatch(tr);
    }
  }
}

class MetaEntriesQueue {
  /**
   * @param {Array<MetaEntry>} [entries=[]]
   */
  constructor (entries = []) {
    this.entries = entries;
  }

  /**
   * @return {MetaEntry|undefined}
   */
  getFirst () {
    return this.entries[0]
  }

  /**
   * @return {MetaEntry|undefined}
   */
  dequeueFirst () {
    return this.entries.shift()
  }

  /**
   * @return {boolean}
   */
  isEmpty () {
    return this.entries.length === 0
  }

  static fromViewsToUpdate () {
    const ups = /** @type {Map<EditorView, Map<any, any>>} */ (viewsToUpdate);
    viewsToUpdate = null;
    const entries = [];
    ups.forEach((metas, view) => {
      metas.forEach((value, key) => {
        entries.push(new MetaEntry(view, key, value));
      });
    });
    return new MetaEntriesQueue(entries)
  }
}

/**
 * Dispatch queued plugin metadata in order, retrying only the remaining
 * entries if a transaction becomes stale while the async queue is flushing.
 *
 * Cursor awareness updates are decoration-only refreshes. If a real document
 * transaction lands before one of these queued meta transactions is applied,
 * ProseMirror can reject it with a RangeError. In that case we reschedule the
 * remaining entries on the next tick. If the first remaining entry fails again
 * on retry, we drop that entry and continue with the rest of the queue instead
 * of retrying forever or crashing the editor.
 *
 * @param {MetaEntriesQueue} [metaEntries=MetaEntriesQueue.fromViewsToUpdate()]
 * @param {boolean} [isRetry=false]
 */
const updateMetas = (metaEntries = MetaEntriesQueue.fromViewsToUpdate(), isRetry = false) => {
  let isFirst = true;
  while (!metaEntries.isEmpty()) {
    const metaEntry = metaEntries.getFirst();
    try {
      metaEntry.apply();
    } catch (err) {
      // ProseMirror throws a RangeError when this transaction was created from
      // an older state and another transaction changed the document before this
      // meta-only dispatch was applied ("Applying a mismatched transaction").
      if (err instanceof RangeError) {
        if (isRetry && isFirst) {
          // Drop the repeatedly stale entry so the queue can continue flushing.
          metaEntries.dequeueFirst();
        }
        if (!metaEntries.isEmpty()) {
          eventloop.timeout(0, () => updateMetas(metaEntries, true));
        }
        return
      }
      throw err
    }
    isFirst = false;
    metaEntries.dequeueFirst();
  }
};

const setMeta = (view, key, value) => {
  if (!viewsToUpdate) {
    viewsToUpdate = new Map();
    // Awareness listeners can fire in bursts, so batch them into one tick.
    eventloop.timeout(0, updateMetas);
  }
  map.setIfUndefined(viewsToUpdate, view, map.create).set(key, value);
};

/**
 * Transforms a Prosemirror based absolute position to a Yjs Cursor (relative position in the Yjs model).
 *
 * @param {number} pos
 * @param {Y.XmlFragment} type
 * @param {ProsemirrorMapping} mapping
 * @return {any} relative position
 */
const absolutePositionToRelativePosition = (pos, type, mapping) => {
  if (pos === 0) {
    return Y.createRelativePositionFromTypeIndex(type, 0, -1)
  }
  /**
   * @type {any}
   */
  let n = type._first === null ? null : /** @type {Y.ContentType} */ (type._first.content).type;
  while (n !== null && type !== n) {
    if (n instanceof Y.XmlText) {
      if (n._length >= pos) {
        return Y.createRelativePositionFromTypeIndex(n, pos, -1)
      } else {
        pos -= n._length;
      }
      if (n._item !== null && n._item.next !== null) {
        n = /** @type {Y.ContentType} */ (n._item.next.content).type;
      } else {
        do {
          n = n._item === null ? null : n._item.parent;
          pos--;
        } while (n !== type && n !== null && n._item !== null && n._item.next === null)
        if (n !== null && n !== type) {
          // @ts-gnore we know that n.next !== null because of above loop conditition
          n = n._item === null ? null : /** @type {Y.ContentType} */ (/** @type Y.Item */ (n._item.next).content).type;
        }
      }
    } else {
      const pNodeSize = /** @type {any} */ (mapping.get(n) || { nodeSize: 0 }).nodeSize;
      if (n._first !== null && pos < pNodeSize) {
        n = /** @type {Y.ContentType} */ (n._first.content).type;
        pos--;
      } else {
        if (pos === 1 && n._length === 0 && pNodeSize > 1) {
          // edge case, should end in this paragraph
          return new Y.RelativePosition(n._item === null ? null : n._item.id, n._item === null ? Y.findRootTypeKey(n) : null, null)
        }
        pos -= pNodeSize;
        if (n._item !== null && n._item.next !== null) {
          n = /** @type {Y.ContentType} */ (n._item.next.content).type;
        } else {
          if (pos === 0) {
            // set to end of n.parent
            n = n._item === null ? n : n._item.parent;
            return new Y.RelativePosition(n._item === null ? null : n._item.id, n._item === null ? Y.findRootTypeKey(n) : null, null)
          }
          do {
            n = /** @type {Y.Item} */ (n._item).parent;
            pos--;
          } while (n !== type && /** @type {Y.Item} */ (n._item).next === null)
          // if n is null at this point, we have an unexpected case
          if (n !== type) {
            // We know that n._item.next is defined because of above loop condition
            n = /** @type {Y.ContentType} */ (/** @type {Y.Item} */ (/** @type {Y.Item} */ (n._item).next).content).type;
          }
        }
      }
    }
    if (n === null) {
      throw error.unexpectedCase()
    }
    if (pos === 0 && n.constructor !== Y.XmlText && n !== type) { // TODO: set to <= 0
      return createRelativePosition(n._item.parent, n._item)
    }
  }
  return Y.createRelativePositionFromTypeIndex(type, type._length, -1)
};

const createRelativePosition = (type, item) => {
  let typeid = null;
  let tname = null;
  if (type._item === null) {
    tname = Y.findRootTypeKey(type);
  } else {
    typeid = Y.createID(type._item.id.client, type._item.id.clock);
  }
  return new Y.RelativePosition(typeid, tname, item.id)
};

/**
 * @param {Y.Doc} y
 * @param {Y.XmlFragment} documentType Top level type that is bound to pView
 * @param {any} relPos Encoded Yjs based relative position
 * @param {ProsemirrorMapping} mapping
 * @return {null|number}
 */
const relativePositionToAbsolutePosition = (y, documentType, relPos, mapping) => {
  const decodedPos = Y.createAbsolutePositionFromRelativePosition(relPos, y);
  if (decodedPos === null || (decodedPos.type !== documentType && !Y.isParentOf(documentType, decodedPos.type._item))) {
    return null
  }
  let type = decodedPos.type;
  let pos = 0;
  if (type.constructor === Y.XmlText) {
    pos = decodedPos.index;
  } else if (type._item === null || !type._item.deleted) {
    let n = type._first;
    let i = 0;
    while (i < type._length && i < decodedPos.index && n !== null) {
      if (!n.deleted) {
        const t = /** @type {Y.ContentType} */ (n.content).type;
        i++;
        if (t instanceof Y.XmlText) {
          pos += t._length;
        } else {
          const mapped = mapping.get(t);
          if (mapped == null) {
            return null
          }
          pos += /** @type {any} */ (mapped).nodeSize;
        }
      }
      n = /** @type {Y.Item} */ (n.right);
    }
    pos += 1; // increase because we go out of n
  }
  while (type !== documentType && type._item !== null) {
    // @ts-ignore
    const parent = type._item.parent;
    // @ts-ignore
    if (parent._item === null || !parent._item.deleted) {
      pos += 1; // the start tag
      let n = /** @type {Y.AbstractType} */ (parent)._first;
      // now iterate until we found type
      while (n !== null) {
        const contentType = /** @type {Y.ContentType} */ (n.content).type;
        if (contentType === type) {
          break
        }
        if (!n.deleted) {
          if (contentType instanceof Y.XmlText) {
            pos += contentType._length;
          } else {
            const mapped = mapping.get(contentType);
            if (mapped == null) {
              return null
            }
            pos += /** @type {any} */ (mapped).nodeSize;
          }
        }
        n = n.right;
      }
    }
    type = /** @type {Y.AbstractType} */ (parent);
  }
  return pos - 1 // we don't count the most outer tag, because it is a fragment
};

/**
 * Utility function for converting an Y.Fragment to a ProseMirror fragment.
 *
 * @param {Y.XmlFragment} yXmlFragment
 * @param {Schema} schema
 */
const yXmlFragmentToProseMirrorFragment = (yXmlFragment, schema) => {
  const fragmentContent = yXmlFragment.toArray().map((t) =>
    createNodeFromYElement(
      /** @type {Y.XmlElement} */ (t),
      schema,
      createEmptyMeta()
    )
  ).filter((n) => n !== null);
  return Fragment.fromArray(fragmentContent)
};

/**
 * Utility function for converting an Y.Fragment to a ProseMirror node.
 *
 * @param {Y.XmlFragment} yXmlFragment
 * @param {Schema} schema
 */
const yXmlFragmentToProseMirrorRootNode = (yXmlFragment, schema) =>
  schema.topNodeType.create(null, yXmlFragmentToProseMirrorFragment(yXmlFragment, schema));

/**
 * The initial ProseMirror content should be supplied by Yjs. This function transforms a Y.Fragment
 * to a ProseMirror Doc node and creates a mapping that is used by the sync plugin.
 *
 * @param {Y.XmlFragment} yXmlFragment
 * @param {Schema} schema
 *
 * @todo deprecate mapping property
 */
const initProseMirrorDoc = (yXmlFragment, schema) => {
  const meta = createEmptyMeta();
  const fragmentContent = yXmlFragment.toArray().map((t) =>
    createNodeFromYElement(
      /** @type {Y.XmlElement} */ (t),
      schema,
      meta
    )
  ).filter((n) => n !== null);
  const doc = schema.topNodeType.create(null, Fragment.fromArray(fragmentContent));
  return { doc, meta, mapping: meta.mapping }
};

/**
 * Utility method to convert a Prosemirror Doc Node into a Y.Doc.
 *
 * This can be used when importing existing content to Y.Doc for the first time,
 * note that this should not be used to rehydrate a Y.Doc from a database once
 * collaboration has begun as all history will be lost
 *
 * @param {Node} doc
 * @param {string} xmlFragment
 * @return {Y.Doc}
 */
function prosemirrorToYDoc (doc, xmlFragment = 'prosemirror') {
  const ydoc = new Y.Doc();
  const type = /** @type {Y.XmlFragment} */ (ydoc.get(xmlFragment, Y.XmlFragment));
  if (!type.doc) {
    return ydoc
  }

  prosemirrorToYXmlFragment(doc, type);
  return type.doc
}

/**
 * Utility method to update an empty Y.XmlFragment with content from a Prosemirror Doc Node.
 *
 * This can be used when importing existing content to Y.Doc for the first time,
 * note that this should not be used to rehydrate a Y.Doc from a database once
 * collaboration has begun as all history will be lost
 *
 * Note: The Y.XmlFragment does not need to be part of a Y.Doc document at the time that this
 * method is called, but it must be added before any other operations are performed on it.
 *
 * @param {Node} doc prosemirror document.
 * @param {Y.XmlFragment} [xmlFragment] If supplied, an xml fragment to be
 *   populated from the prosemirror state; otherwise a new XmlFragment will be created.
 * @return {Y.XmlFragment}
 */
function prosemirrorToYXmlFragment (doc, xmlFragment) {
  const type = xmlFragment || new Y.XmlFragment();
  const ydoc = type.doc ? type.doc : { transact: (transaction) => transaction(undefined) };
  updateYFragment(ydoc, type, doc, { mapping: new Map(), isOMark: new Map() });
  return type
}

/**
 * Utility method to convert Prosemirror compatible JSON into a Y.Doc.
 *
 * This can be used when importing existing content to Y.Doc for the first time,
 * note that this should not be used to rehydrate a Y.Doc from a database once
 * collaboration has begun as all history will be lost
 *
 * @param {Schema} schema
 * @param {any} state
 * @param {string} xmlFragment
 * @return {Y.Doc}
 */
function prosemirrorJSONToYDoc (schema, state, xmlFragment = 'prosemirror') {
  const doc = Node.fromJSON(schema, state);
  return prosemirrorToYDoc(doc, xmlFragment)
}

/**
 * Utility method to convert Prosemirror compatible JSON to a Y.XmlFragment
 *
 * This can be used when importing existing content to Y.Doc for the first time,
 * note that this should not be used to rehydrate a Y.Doc from a database once
 * collaboration has begun as all history will be lost
 *
 * @param {Schema} schema
 * @param {any} state
 * @param {Y.XmlFragment} [xmlFragment] If supplied, an xml fragment to be
 *   populated from the prosemirror state; otherwise a new XmlFragment will be created.
 * @return {Y.XmlFragment}
 */
function prosemirrorJSONToYXmlFragment (schema, state, xmlFragment) {
  const doc = Node.fromJSON(schema, state);
  return prosemirrorToYXmlFragment(doc, xmlFragment)
}

/**
 * @deprecated Use `yXmlFragmentToProseMirrorRootNode` instead
 *
 * Utility method to convert a Y.Doc to a Prosemirror Doc node.
 *
 * @param {Schema} schema
 * @param {Y.Doc} ydoc
 * @return {Node}
 */
function yDocToProsemirror (schema, ydoc) {
  const state = yDocToProsemirrorJSON(ydoc);
  return Node.fromJSON(schema, state)
}

/**
 *
 * @deprecated Use `yXmlFragmentToProseMirrorRootNode` instead
 *
 * Utility method to convert a Y.XmlFragment to a Prosemirror Doc node.
 *
 * @param {Schema} schema
 * @param {Y.XmlFragment} xmlFragment
 * @return {Node}
 */
function yXmlFragmentToProsemirror (schema, xmlFragment) {
  const state = yXmlFragmentToProsemirrorJSON(xmlFragment);
  return Node.fromJSON(schema, state)
}

/**
 *
 * @deprecated Use `yXmlFragmentToProseMirrorRootNode` instead
 *
 * Utility method to convert a Y.Doc to Prosemirror compatible JSON.
 *
 * @param {Y.Doc} ydoc
 * @param {string} xmlFragment
 * @return {Record<string, any>}
 */
function yDocToProsemirrorJSON (
  ydoc,
  xmlFragment = 'prosemirror'
) {
  return yXmlFragmentToProsemirrorJSON(ydoc.getXmlFragment(xmlFragment))
}

/**
 * @deprecated Use `yXmlFragmentToProseMirrorRootNode` instead
 *
 * Utility method to convert a Y.Doc to Prosemirror compatible JSON.
 *
 * @param {Y.XmlFragment} xmlFragment The fragment, which must be part of a Y.Doc.
 * @return {Record<string, any>}
 */
function yXmlFragmentToProsemirrorJSON (xmlFragment) {
  const items = xmlFragment.toArray();

  /**
   * @param {Y.AbstractType} item
   */
  const serialize = item => {
    /**
     * @type {Object} NodeObject
     * @property {string} NodeObject.type
     * @property {Record<string, string>=} NodeObject.attrs
     * @property {Array<NodeObject>=} NodeObject.content
     */
    let response;

    // TODO: Must be a better way to detect text nodes than this
    if (item instanceof Y.XmlText) {
      const delta = item.toDelta();
      response = delta.map(/** @param {any} d */ (d) => {
        const text = {
          type: 'text',
          text: d.insert
        };
        if (d.attributes) {
          text.marks = Object.keys(d.attributes).map((type_) => {
            const attrs = d.attributes[type_];
            const type = yattr2markname(type_);
            const mark = {
              type
            };
            if (Object.keys(attrs)) {
              mark.attrs = attrs;
            }
            return mark
          });
        }
        return text
      });
    } else if (item instanceof Y.XmlElement) {
      response = {
        type: item.nodeName
      };

      const attrs = item.getAttributes();
      if (Object.keys(attrs).length) {
        response.attrs = attrs;
      }

      const children = item.toArray();
      if (children.length) {
        response.content = children.map(serialize).flat();
      }
    } else {
      // expected either Y.XmlElement or Y.XmlText
      error.unexpectedCase();
    }

    return response
  };

  return {
    type: 'doc',
    content: items.map(serialize)
  }
}

/**
 * Default awareness state filter
 *
 * @param {number} currentClientId current client id
 * @param {number} userClientId user client id
 * @param {any} _user user data
 * @return {boolean}
 */
const defaultAwarenessStateFilter = (
  currentClientId,
  userClientId,
  _user
) => currentClientId !== userClientId;

/**
 * Default generator for a cursor element
 *
 * @param {any} user user data
 * @return {HTMLElement}
 */
const defaultCursorBuilder = (user) => {
  const cursor = document.createElement('span');
  cursor.classList.add('ProseMirror-yjs-cursor');
  cursor.setAttribute('style', `border-color: ${user.color}`);
  const userDiv = document.createElement('div');
  userDiv.setAttribute('style', `background-color: ${user.color}`);
  userDiv.insertBefore(document.createTextNode(user.name), null);
  const nonbreakingSpace1 = document.createTextNode('\u2060');
  const nonbreakingSpace2 = document.createTextNode('\u2060');
  cursor.insertBefore(nonbreakingSpace1, null);
  cursor.insertBefore(userDiv, null);
  cursor.insertBefore(nonbreakingSpace2, null);
  return cursor
};

/**
 * Default generator for the selection attributes
 *
 * @param {any} user user data
 * @return {import('prosemirror-view').DecorationAttrs}
 */
const defaultSelectionBuilder = (user) => {
  return {
    style: `background-color: ${user.color}70`,
    class: 'ProseMirror-yjs-selection'
  }
};

const rxValidColor = /^#[0-9a-fA-F]{6}$/;

/**
 * @param {any} state
 * @param {Awareness} awareness
 * @param {function(number, number, any):boolean} awarenessFilter
 * @param {(user: { name: string, color: string }, clientId: number) => Element} createCursor
 * @param {(user: { name: string, color: string }, clientId: number) => import('prosemirror-view').DecorationAttrs} createSelection
 * @return {any} DecorationSet
 */
const createDecorations = (
  state,
  awareness,
  awarenessFilter,
  createCursor,
  createSelection
) => {
  const ystate = ySyncPluginKey.getState(state);
  if (ystate == null || ystate.doc == null || ystate.binding == null) {
    return DecorationSet.create(state.doc, [])
  }
  const y = ystate.doc;
  const decorations = [];
  if (
    ystate.snapshot != null ||
    ystate.prevSnapshot != null ||
    ystate.binding.mapping.size === 0
  ) {
    // do not render cursors while snapshot is active
    return DecorationSet.create(state.doc, [])
  }
  awareness.getStates().forEach((aw, clientId) => {
    if (!awarenessFilter(y.clientID, clientId, aw)) {
      return
    }

    // `aw` can be null when a client disconnects, so we guard against it
    // before reading `cursor` to avoid a TypeError.
    if (aw && aw.cursor != null) {
      const user = aw.user || {};
      if (user.color == null) {
        user.color = '#ffa500';
      } else if (!rxValidColor.test(user.color)) {
        // We only support 6-digit RGB colors in y-prosemirror
        console.warn('A user uses an unsupported color format', user);
      }
      if (user.name == null) {
        user.name = `User: ${clientId}`;
      }
      let anchor = relativePositionToAbsolutePosition(
        y,
        ystate.type,
        Y.createRelativePositionFromJSON(aw.cursor.anchor),
        ystate.binding.mapping
      );
      let head = relativePositionToAbsolutePosition(
        y,
        ystate.type,
        Y.createRelativePositionFromJSON(aw.cursor.head),
        ystate.binding.mapping
      );
      if (anchor !== null && head !== null) {
        const maxsize = math.max(state.doc.content.size - 1, 0);
        anchor = math.min(anchor, maxsize);
        head = math.min(head, maxsize);
        decorations.push(
          Decoration.widget(head, () => createCursor(user, clientId), {
            key: clientId + '',
            side: 10
          })
        );
        const from = math.min(anchor, head);
        const to = math.max(anchor, head);
        decorations.push(
          Decoration.inline(from, to, createSelection(user, clientId), {
            inclusiveEnd: true,
            inclusiveStart: false
          })
        );
      }
    }
  });
  return DecorationSet.create(state.doc, decorations)
};

/**
 * A prosemirror plugin that listens to awareness information on Yjs.
 * This requires that a `prosemirrorPlugin` is also bound to the prosemirror.
 *
 * @public
 * @param {Awareness} awareness
 * @param {object} opts
 * @param {function(any, any, any):boolean} [opts.awarenessStateFilter]
 * @param {(user: any, clientId: number) => HTMLElement} [opts.cursorBuilder]
 * @param {(user: any, clientId: number) => import('prosemirror-view').DecorationAttrs} [opts.selectionBuilder]
 * @param {function(any):any} [opts.getSelection]
 * @param {string} [cursorStateField] By default all editor bindings use the awareness 'cursor' field to propagate cursor information.
 * @return {any}
 */
const yCursorPlugin = (
  awareness,
  {
    awarenessStateFilter = defaultAwarenessStateFilter,
    cursorBuilder = defaultCursorBuilder,
    selectionBuilder = defaultSelectionBuilder,
    getSelection = (state) => state.selection
  } = {},
  cursorStateField = 'cursor'
) =>
  new Plugin({
    key: yCursorPluginKey,
    state: {
      init (_, state) {
        return createDecorations(
          state,
          awareness,
          awarenessStateFilter,
          cursorBuilder,
          selectionBuilder
        )
      },
      apply (tr, prevState, _oldState, newState) {
        const ystate = ySyncPluginKey.getState(newState);
        const yCursorState = tr.getMeta(yCursorPluginKey);
        if (
          (ystate && ystate.isChangeOrigin) ||
          (yCursorState && yCursorState.awarenessUpdated)
        ) {
          return createDecorations(
            newState,
            awareness,
            awarenessStateFilter,
            cursorBuilder,
            selectionBuilder
          )
        }
        return prevState.map(tr.mapping, tr.doc)
      }
    },
    props: {
      decorations: (state) => {
        return yCursorPluginKey.getState(state)
      }
    },
    view: (view) => {
      const awarenessListener = () => {
        // @ts-ignore
        if (view.docView) {
          setMeta(view, yCursorPluginKey, { awarenessUpdated: true });
        }
      };
      const updateCursorInfo = () => {
        const ystate = ySyncPluginKey.getState(view.state);
        // `ystate` is undefined during sync-plugin init and Y.Doc transitions;
        // reading from it here would throw and break cursor tracking for the view.
        if (!ystate || !ystate.binding) return
        // @note We make implicit checks when checking for the cursor property
        const current = awareness.getLocalState() || {};
        if (view.hasFocus()) {
          const selection = getSelection(view.state);
          /**
           * @type {Y.RelativePosition}
           */
          const anchor = absolutePositionToRelativePosition(
            selection.anchor,
            ystate.type,
            ystate.binding.mapping
          );
          /**
           * @type {Y.RelativePosition}
           */
          const head = absolutePositionToRelativePosition(
            selection.head,
            ystate.type,
            ystate.binding.mapping
          );
          if (
            current.cursor == null ||
            !Y.compareRelativePositions(
              Y.createRelativePositionFromJSON(current.cursor.anchor),
              anchor
            ) ||
            !Y.compareRelativePositions(
              Y.createRelativePositionFromJSON(current.cursor.head),
              head
            )
          ) {
            awareness.setLocalStateField(cursorStateField, {
              anchor,
              head
            });
          }
        } else if (
          current.cursor != null &&
          relativePositionToAbsolutePosition(
            ystate.doc,
            ystate.type,
            Y.createRelativePositionFromJSON(current.cursor.anchor),
            ystate.binding.mapping
          ) !== null
        ) {
          // delete cursor information if current cursor information is owned by this editor binding
          awareness.setLocalStateField(cursorStateField, null);
        }
      };
      awareness.on('change', awarenessListener);
      view.dom.addEventListener('focusin', updateCursorInfo);
      view.dom.addEventListener('focusout', updateCursorInfo);
      return {
        update: updateCursorInfo,
        destroy: () => {
          view.dom.removeEventListener('focusin', updateCursorInfo);
          view.dom.removeEventListener('focusout', updateCursorInfo);
          awareness.off('change', awarenessListener);
          awareness.setLocalStateField(cursorStateField, null);
        }
      }
    }
  });

const undo = state => {
  const undoManager = yUndoPluginKey.getState(state).undoManager;
  if (undoManager != null) {
    undoManager.undo();
    return true
  }
};

const redo = state => {
  const undoManager = yUndoPluginKey.getState(state).undoManager;
  if (undoManager != null) {
    undoManager.redo();
    return true
  }
};

const defaultProtectedNodes = new Set(['paragraph']);

const defaultDeleteFilter = (item, protectedNodes) => !(item instanceof Item) ||
!(item.content instanceof ContentType) ||
!(item.content.type instanceof Text ||
  (item.content.type instanceof XmlElement && protectedNodes.has(item.content.type.nodeName))) ||
item.content.type._length === 0;

const yUndoPlugin = ({ protectedNodes = defaultProtectedNodes, trackedOrigins = [], undoManager = null } = {}) => new Plugin({
  key: yUndoPluginKey,
  state: {
    init: (initargs, state) => {
      // TODO: check if plugin order matches and fix
      const ystate = ySyncPluginKey.getState(state);
      let _undoManager = undoManager;
      if (!_undoManager) {
        // Y.UndoManager registers a `doc.on('destroy', …)` listener in its
        // constructor that UndoManager.destroy() never removes. When the doc
        // outlives the editor (e.g. several editors sharing one provider), that
        // listener keeps the UndoManager — and everything it references —
        // reachable from the doc, leaking memory on every editor destroy.
        // We only own the lifecycle of a manager we create here, so capture the
        // listener(s) it adds and remove them when the plugin view is destroyed.
        const doc = ystate.doc;
        const destroyListenersBefore = new Set(doc ? doc._observers.get('destroy') : []);
        _undoManager = new UndoManager(ystate.type, {
          trackedOrigins: new Set([ySyncPluginKey].concat(trackedOrigins)),
          deleteFilter: (item) => defaultDeleteFilter(item, protectedNodes),
          captureTransaction: tr => tr.meta.get('addToHistory') !== false
        });
        const destroyListenersAfter = doc ? doc._observers.get('destroy') : new Set();
        _undoManager._yTiptapDocDestroyListeners = Array.from(destroyListenersAfter || [])
          .filter(listener => !destroyListenersBefore.has(listener));
      }
      return {
        undoManager: _undoManager,
        prevSel: null,
        hasUndoOps: _undoManager.undoStack.length > 0,
        hasRedoOps: _undoManager.redoStack.length > 0
      }
    },
    /**
     * @returns {any}
     */
    apply: (tr, val, oldState, state) => {
      const binding = ySyncPluginKey.getState(state).binding;
      const undoManager = val.undoManager;
      const hasUndoOps = undoManager.undoStack.length > 0;
      const hasRedoOps = undoManager.redoStack.length > 0;
      if (binding) {
        return {
          undoManager,
          prevSel: getRelativeSelection(binding, oldState),
          hasUndoOps,
          hasRedoOps
        }
      } else {
        if (hasUndoOps !== val.hasUndoOps || hasRedoOps !== val.hasRedoOps) {
          return Object.assign({}, val, {
            hasUndoOps: undoManager.undoStack.length > 0,
            hasRedoOps: undoManager.redoStack.length > 0
          })
        } else { // nothing changed
          return val
        }
      }
    }
  },
  view: view => {
    const ystate = ySyncPluginKey.getState(view.state);
    const undoManager = yUndoPluginKey.getState(view.state).undoManager;
    undoManager.on('stack-item-added', ({ stackItem }) => {
      const binding = ystate.binding;
      if (binding) {
        stackItem.meta.set(binding, yUndoPluginKey.getState(view.state).prevSel);
      }
    });
    undoManager.on('stack-item-popped', ({ stackItem }) => {
      const binding = ystate.binding;
      if (binding) {
        binding.beforeTransactionSelection = stackItem.meta.get(binding) || binding.beforeTransactionSelection;
      }
    });
    return {
      destroy: () => {
        undoManager.destroy();
        // Remove the doc 'destroy' listener Y.UndoManager fails to clean up
        // (only for managers we created — see state.init above).
        const leakedDestroyListeners = undoManager._yTiptapDocDestroyListeners;
        if (leakedDestroyListeners && undoManager.doc) {
          leakedDestroyListeners.forEach(listener => undoManager.doc.off('destroy', listener));
          undoManager._yTiptapDocDestroyListeners = null;
        }
      }
    }
  }
});

export { ProsemirrorBinding, absolutePositionToRelativePosition, createDecorations, defaultAwarenessStateFilter, defaultCursorBuilder, defaultDeleteFilter, defaultProtectedNodes, defaultSelectionBuilder, getRelativeSelection, initProseMirrorDoc, isVisible, prosemirrorJSONToYDoc, prosemirrorJSONToYXmlFragment, prosemirrorToYDoc, prosemirrorToYXmlFragment, redo, relativePositionToAbsolutePosition, setMeta, undo, updateYFragment, yCursorPlugin, yCursorPluginKey, yDocToProsemirror, yDocToProsemirrorJSON, ySyncPlugin, ySyncPluginKey, yUndoPlugin, yUndoPluginKey, yXmlFragmentToProseMirrorFragment, yXmlFragmentToProseMirrorRootNode, yXmlFragmentToProsemirror, yXmlFragmentToProsemirrorJSON };
//# sourceMappingURL=y-tiptap.js.map
