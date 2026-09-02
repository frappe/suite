<template>
  <div class="sn-root">

    <!-- Load-time error state: the sheet doesn't exist, the caller lacks
         access to it, or the request failed for some other reason. We
         distinguish denied vs missing because the recovery is different
         ("ask the owner to share" vs "broken link / deleted"). The user
         can always click the brand mark or the "Back to home" button to
         exit. -->
    <div v-if="loadError" class="sn-load-error">
      <div class="sn-load-error-icon">
        <svg width="56" height="56" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="10" stroke="#A3A3A3" stroke-width="1.5" />
          <path d="M12 7v6" stroke="#A3A3A3" stroke-width="1.5" stroke-linecap="round" />
          <circle cx="12" cy="16.5" r="1" fill="#A3A3A3" />
        </svg>
      </div>
      <h2 class="sn-load-error-title">
        <template v-if="loadError.kind === 'denied'">You don't have access to this sheet</template>
        <template v-else-if="loadError.kind === 'missing'">this sheet doesn't exist</template>
        <template v-else>Couldn't open this sheet</template>
      </h2>
      <p class="sn-load-error-sub">
        <template v-if="loadError.kind === 'denied'">Ask the owner to share it with you, then reload.</template>
        <template v-else-if="loadError.kind === 'missing'">It may have been deleted, or the link is wrong.</template>
        <template v-else>{{ loadError.message }}</template>
      </p>
      <Button variant="solid" @click="emit('close')">Back to home</Button>
    </div>

    <template v-else>
    <!-- Bar 1 · Identity -->
    <div class="sn-topbar">
      <div class="sn-topbar-left">
        <div class="sn-identity">
          <Dropdown :options="brandMenuOptions" :offset="16">
            <template #default="{ open }">
              <div class="sn-app-menu-trigger" aria-label="Open Sheets menu" title="Open Sheets menu">
                <svg class="sn-app-icon" width="28" height="28" viewBox="0 0 118 118" fill="none" aria-hidden="true">
                  <path d="M93.9278 0H23.1013C10.3428 0 0 10.3428 0 23.1013V93.9278C0 106.686 10.3428 117.029 23.1013 117.029H93.9278C106.686 117.029 117.029 106.686 117.029 93.9278V23.1013C117.029 10.3428 106.686 0 93.9278 0Z" fill="#278F5E"/>
                  <path d="M77.757 25.9364H23.5215V36.437H77.757C80.6447 36.437 83.0073 38.7996 83.0073 41.6873V75.3942C83.0073 78.2818 80.6447 80.6445 77.757 80.6445H39.2724C36.3847 80.6445 34.0221 78.2818 34.0221 75.3942V50.6653H23.5215V75.3942C23.5215 84.0572 30.6094 91.1451 39.2724 91.1451H77.757C86.42 91.1451 93.5079 84.0572 93.5079 75.3942V41.6873C93.5079 33.0243 86.42 25.9364 77.757 25.9364Z" fill="white"/>
                  <path d="M53.8678 59.6958H43.3672V70.0914H53.8678V59.6958Z" fill="white"/>
                  <path d="M73.6617 50.6653H63.1611V70.1439H73.6617V50.6653Z" fill="white"/>
                </svg>
                <FeatherIcon :name="open ? 'chevron-up' : 'chevron-down'" class="size-4 text-ink-gray-7" />
              </div>
            </template>
          </Dropdown>
          <Breadcrumbs v-if="!isTitleEditing" :items="sheetBreadcrumbs" />
          <template v-else>
            <div class="flex min-w-0 items-center">
              <Breadcrumbs class="sn-parent-breadcrumb" :items="sheetHomeBreadcrumbs" />
              <span class="mx-0.5 text-base text-ink-gray-4" aria-hidden="true">/</span>
              <InlineRenameInput
                v-model="currentTitle"
                :editing="isTitleEditing"
                appearance="breadcrumb"
                class="max-w-[520px]"
                @submit="finishTitleEditing"
                @cancel="cancelTitleEditing"
                @blur="finishTitleEditing"
              />
            </div>
          </template>
        </div>
        <!-- Save status — muted inline text; never competes with the title -->
        <span v-if="isSaving" class="sn-save-status">
          <FeatherIcon name="loader" class="sn-save-icon sn-save-spin" />
          Saving…
        </span>
        <span v-else-if="justSaved" class="sn-save-status">
          <FeatherIcon name="check" class="sn-save-icon" />
          Saved
        </span>
        <template v-if="saveError">
          <Badge theme="red" variant="subtle" size="sm" :label="saveError" :tooltip="saveError" />
          <Button
            variant="ghost"
            size="sm"
            icon="lucide-refresh-cw"
            tooltip="Retry save"
            :loading="isSaving"
            @click="onRetrySave"
          />
        </template>
        <Badge v-if="protectionNotice" theme="gray" variant="subtle" size="sm" :label="protectionNotice" :tooltip="protectionNotice" />
        <!-- View-only indicator — shown up front so a viewer knows they can't
             edit before they try. Neutral gray (not an error) because read
             access is expected, not a failure. Uses the Frappe UI Badge so it
             matches the save-error chip beside it and the Espresso tokens. -->
        <Tooltip v-if="readOnly" text="You have view access. Ask the owner for edit access to make changes.">
          <Badge theme="gray" variant="subtle" size="lg" label="View only">
            <template #prefix><FeatherIcon name="eye" class="h-3.5 w-3.5" /></template>
          </Badge>
        </Tooltip>
      </div>
      <div class="sn-topbar-right">
        <!-- AI Assist entry point — shown only when an admin has configured a
             key and enabled it (gated server-side via the boot flag). -->
        <template v-if="aiEnabled && !readOnly">
          <Button
            variant="ghost"
            size="sm"
            icon="lucide-sparkles"
            label="Ask AI"
            tooltip="Ask AI to work on your selection"
            @click="openAskBar"
          />
          <span class="sn-topbar-divider" aria-hidden="true" />
        </template>
        <Dropdown :options="fileDropdownOptions" align="end">
          <template #default="{ open }">
            <Button :variant="open ? 'subtle' : 'ghost'" size="sm" iconLeft="lucide-file-text" iconRight="lucide-chevron-down" label="File" tooltip="Import / export" />
          </template>
        </Dropdown>
        <input ref="csvInputRef"  name="csv-import"  type="file" accept=".csv"                   style="display:none" @change="importCSV" />
        <input ref="xlsxInputRef" name="xlsx-import" type="file" accept=".xlsx,.xls,.xlsm,.ods"  style="display:none" @change="importXLSX" />
        <span class="sn-topbar-divider" aria-hidden="true" />
        <!-- Notes: button toggles the side panel listing all notes across sheets.
             Shift+F2 still opens the per-cell inline editor for quick capture. -->
        <span class="sn-notes-btn-wrap">
          <Button :variant="notesPanel.open ? 'subtle' : 'ghost'"
                  size="sm" icon="lucide-message-square"
                  :tooltip="`Notes${allNotes.length ? ` (${allNotes.length})` : ''} — Shift+F2 to add`"
                  @click="toggleNotesPanel" />
          <span v-if="allNotes.length" class="sn-notes-badge">{{ allNotes.length > 9 ? '9+' : allNotes.length }}</span>
        </span>
        <!-- Variant flips to "subtle" while the panel is open so the trigger
             reads as toggled, matching Frappe UI's standard toggle pattern. -->
        <Button :variant="vhOpen ? 'subtle' : 'ghost'"
                size="sm" icon="lucide-clock"
                tooltip="Version history"
                @click="vhOpen ? closeVersionHistory() : (notesPanel.open = false, openVersionHistory())" />
        <Button variant="ghost" size="sm" icon="lucide-help-circle" tooltip="Keyboard shortcuts" @click="showShortcutsHelp = true" />
        <span class="sn-topbar-divider" aria-hidden="true" />
        <!-- Presence avatars — other users currently in the workbook.
             Outline = their cursor color; tooltip says which sub-sheet
             they're on so cross-sheet collaborators are discoverable. -->
        <div v-if="presentUsers.length" class="sn-presence">
          <Avatar
            v-for="u in presentUsers.slice(0, 3)"
            :key="u.user"
            :label="u.initials"
            :image="u.user_image || undefined"
            size="sm"
            :tooltip="u.sub_sheet && u.sub_sheet !== currentSheet
              ? `${u.full_name} — on ${u.sub_sheet}`
              : u.full_name"
            class="sn-presence-avatar"
            :style="{ '--rc': u.color }"
          />
          <span
            v-if="presentUsers.length > 3"
            class="sn-presence-more"
            :title="`${presentUsers.length - 3} more people`"
          >+{{ presentUsers.length - 3 }}</span>
        </div>
        <!-- Share -->
        <Button
          variant="ghost"
          size="sm"
          icon="lucide-share-2"
          :label="shareCount > 0 ? `Share · ${shareCount}` : 'Share'"
          tooltip="Share this sheet"
          @click="shareOpen = true"
        />
        <span class="sn-topbar-divider" aria-hidden="true" />
        <Avatar
          :label="userInitial"
          :image="userImage || undefined"
          size="sm"
          :tooltip="userFullName || userEmail"
          class="sn-user-avatar"
        />
      </div>
    </div>

    <!-- Bar 2 · Formatting toolbar -->
    <!-- Read-only viewers: dim the whole bar and swallow pointer events so no
         formatting/insert/chart action is reachable. Undo/Redo and dropdowns
         come along for free without touching each button. -->
    <div class="sn-toolbar" :class="{ 'sn-toolbar--readonly': readOnly }"
         :aria-disabled="readOnly || undefined">

      <!-- Number format -->
      <Dropdown :options="numberFormatDropdownOptions" class="sn-numfmt">
        <template #default="{ open }">
          <Button :variant="open ? 'subtle' : 'ghost'" size="sm" iconRight="lucide-chevron-down" :label="numberFormatLabel" tooltip="Number format" />
        </template>
      </Dropdown>
      <Dropdown :options="currencyDropdownOptions" class="sn-currency">
        <template #default="{ open }">
          <Button :variant="activeNumberFormatType === 'currency' ? 'subtle' : (open ? 'subtle' : 'ghost')" size="sm" :label="activeCurrencySymbol" tooltip="Currency" />
        </template>
      </Dropdown>
      <Button :variant="activeNumberFormatType === 'percentage' ? 'subtle' : 'ghost'" size="sm" label="%" tooltip="Percentage" @click="toggleNumberFmt('percentage')" />
      <Button :variant="activeNumberFormatType === 'number'     ? 'subtle' : 'ghost'" size="sm" label="," tooltip="Thousands separator" @click="toggleNumberFmt('number')" />
      <div class="sn-tool-extra">
        <Button variant="ghost" size="sm" :icon="DecreaseDecimalIcon" tooltip="Decrease decimal places" @click="adjustDecimals(-1)" />
        <Button variant="ghost" size="sm" :icon="IncreaseDecimalIcon" tooltip="Increase decimal places" @click="adjustDecimals(+1)" />
      </div>

      <div class="sn-vr" />

      <!-- Font -->
      <Dropdown :options="fontFamilyDropdownOptions" class="sn-font-family">
        <template #default="{ open }">
          <Button :variant="open ? 'subtle' : 'ghost'" size="sm" iconRight="lucide-chevron-down" :label="activeFontFamilyLabel" tooltip="Font family" />
        </template>
      </Dropdown>
      <Tooltip text="Font size">
        <TextInput type="number" size="sm" class="sn-font-size-input" :model-value="activeFormat.fontSize || 13" min="8" max="72" @change="onFontSizeInput" @keydown.enter.prevent="onFontSizeInput" />
      </Tooltip>

      <div class="sn-vr" />

      <!-- Style -->
      <Button :variant="activeFormat.bold        ? 'subtle' : 'ghost'" :class="{ 'sn-fmt-active': activeFormat.bold }"        size="sm" icon="lucide-bold"                tooltip="Bold (Ctrl+B)"             @click="toggleFmt('bold')" />
      <Button :variant="activeFormat.italic      ? 'subtle' : 'ghost'" :class="{ 'sn-fmt-active': activeFormat.italic }"      size="sm" icon="lucide-italic"              tooltip="Italic (Ctrl+I)"           @click="toggleFmt('italic')" />
      <Button :variant="activeFormat.underline   ? 'subtle' : 'ghost'" :class="{ 'sn-fmt-active': activeFormat.underline }"   size="sm" icon="lucide-underline"           tooltip="Underline (Ctrl+U)"        @click="toggleFmt('underline')" />
      <div class="sn-tool-extra">
        <Button :variant="activeFormat.strikethrough ? 'subtle' : 'ghost'" :class="{ 'sn-fmt-active': activeFormat.strikethrough }" size="sm" icon="lucide-strikethrough" tooltip="Strikethrough (Ctrl+Shift+X)" @click="toggleFmt('strikethrough')" />
      </div>

      <div class="sn-vr" />

      <!-- Align + Color -->
      <Dropdown :options="alignDropdownOptions">
        <template #default="{ open }">
          <Button :variant="open ? 'subtle' : 'ghost'" size="sm" :icon="hAlignIcon" tooltip="Alignment" />
        </template>
      </Dropdown>
      <ColorPicker :model-value="activeFormat.color || ''" allow-default default-label="Default text color"
                   title="Text colour" fallback="#171717" @update:model-value="setColor('color', $event)">
        <template #trigger="{ toggle, open }">
          <Tooltip text="Text colour">
            <button type="button" class="sn-swatch-btn" :class="{ 'is-open': open }" @click="toggle()">
              <FeatherIcon name="type" class="sn-swatch-glyph" />
              <span class="sn-swatch-underline" :style="{ background: activeFormat.color || '#171717' }"></span>
            </button>
          </Tooltip>
        </template>
      </ColorPicker>
      <ColorPicker :model-value="activeFormat.backgroundColor || ''" allow-default default-label="No fill"
                   title="Fill colour" fallback="#ffffff" @update:model-value="setColor('backgroundColor', $event)">
        <template #trigger="{ toggle, open }">
          <Tooltip text="Fill colour">
            <button type="button" class="sn-swatch-btn" :class="{ 'is-open': open }" @click="toggle()">
              <FeatherIcon name="droplet" class="sn-swatch-glyph" />
              <span class="sn-swatch-underline sn-swatch-fill" :style="{ background: activeFormat.backgroundColor || '#ffffff' }"></span>
            </button>
          </Tooltip>
        </template>
      </ColorPicker>

      <div class="sn-vr" />

      <!-- Undo / Redo -->
      <Button variant="ghost" size="sm" icon="lucide-corner-up-left"  tooltip="Undo (Ctrl+Z)" :disabled="!canUndo" @click="undo" />
      <Button variant="ghost" size="sm" icon="lucide-corner-up-right" tooltip="Redo (Ctrl+Y)" :disabled="!canRedo" @click="redo" />

      <div class="sn-vr" />

      <!-- Extra tools (visible at wide widths; hidden at narrow — overflow via ···) -->
      <div class="sn-tool-extra">
        <Button :variant="isPaintingFormat ? 'subtle' : 'ghost'" size="sm" icon="lucide-paint-roller"  tooltip="Format painter"             @click="toggleFormatPainter" />
        <Button variant="ghost"                                   size="sm" icon="lucide-eraser"         tooltip="Clear formatting"           @click="clearFormatting" />
        <div class="sn-vr" />
        <Button :variant="showSortFilter ? 'subtle' : 'ghost'"   size="sm" icon="lucide-filter"               tooltip="Toggle filter"              @click="showSortFilter = !showSortFilter" />
        <div class="sn-vr" />
        <Dropdown :options="textWrapDropdownOptions">
          <template #default="{ open }">
            <Button :variant="open ? 'subtle' : 'ghost'" size="sm" :icon="textWrapIcon" tooltip="Text wrapping" />
          </template>
        </Dropdown>
        <div class="sn-vr" />
        <Button variant="ghost" size="sm" icon="lucide-blend"    tooltip="Conditional formatting"      @click="openCfDialog(null)" />
        <Button variant="ghost" size="sm" icon="lucide-link"     tooltip="Insert hyperlink (Ctrl+L)"   @click="openHyperlinkDialog" />
        <div class="sn-vr" />
        <Dropdown :options="borderDropdownOptions">
          <template #default="{ open }">
            <Button :variant="open ? 'subtle' : 'ghost'" size="sm" icon="lucide-layout-grid" tooltip="Borders" />
          </template>
        </Dropdown>
        <!-- Custom merge glyph (Lucide table-cells-merge) — reads as
             "join two cells" better than the generic maximize-2 icon. -->
        <Button variant="ghost" size="sm" tooltip="Merge / unmerge cells" @click="toggleMerge">
          <template #icon>
            <svg viewBox="0 0 24 24" class="sn-merge-glyph" aria-hidden="true"
                 fill="none" stroke="currentColor" stroke-width="1.5"
                 stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 21v-6" />
              <path d="M12 9V3" />
              <path d="M3 15h18" />
              <path d="M3 9h18" />
              <rect width="18" height="18" x="3" y="3" rx="2" />
            </svg>
          </template>
        </Button>
        <div class="sn-vr" />
        <Button variant="ghost" size="sm" icon="lucide-chart-bar" tooltip="Insert chart" @click="openChartDialog()" />
      </div>

      <!-- More -->
      <div class="sn-tool-more">
        <Dropdown :options="moreToolbarOptions">
          <template #default="{ open }">
            <Button :variant="open ? 'subtle' : 'ghost'" size="sm" icon="lucide-more-horizontal" tooltip="More" />
          </template>
        </Dropdown>
      </div>
    </div>

    <!-- Bar 3 · Formula bar -->
    <div class="sn-formula-bar">
      <span class="sn-cell-ref" :title="`Active cell ${activeCell}`">{{ activeCell }}</span>
      <span class="sn-fx-label" aria-hidden="true">fx</span>
      <div class="sn-formula-wrap">
        <input
          ref="formulaInputRef"
          name="formula-bar"
          class="sn-formula-input"
          :value="formulaValue"
          :readonly="readOnly"
          @input="onFormulaInput"
          @keydown="onFormulaKey"
          @blur="closeAc"
          :placeholder="readOnly ? '' : 'Enter value or formula'"
          spellcheck="false"
          autocomplete="off"
        />
        <div v-if="acVisible" class="sn-ac-list" :class="{ 'sn-ac-list--up': acUp }">
          <div
            v-for="(item, i) in acItems"
            :key="item.name + item.kind"
            class="sn-ac-item"
            :class="{ active: i === acIdx }"
            @mousedown.prevent="commitAc(item)"
          >
            <span class="sn-ac-name">{{ item.name }}</span>
            <span v-if="item.kind === 'fn'"    class="sn-ac-sig">{{ AC_FUNS[item.name] }}</span>
            <span v-else                        class="sn-ac-badge">sheet</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Version preview banner — only when previewing -->
    <VersionPreviewBanner
      :open="!!vhActive"
      :version="vhVersions.find(v => v.name === vhActive)"
      :restoring="vhRestoring"
      :diff="vhDiff"
      :step-index="vhStepIdx"
      @restore="restorePreview"
      @exit="exitPreview"
      @name="nameCurrentPreview"
      @step="stepPreviewDiff"
    />

    <!-- Canvas grid + filter overlay -->
    <!-- wheel.capture: the link hover card is anchored to a cell's pixel rect,
         which any scroll invalidates — hide it rather than let it float. -->
    <div ref="gridWrapRef" class="sn-grid-wrap"
         :class="{ 'sn-painting-format': isPaintingFormat, 'sn-preview-locked': !!vhActive }"
         @wheel.capture.passive="linkCard.open = false">
      <canvas ref="canvasRef" />

      <!-- Initial-load shim. The canvas is mounted (so grid.resize / event
           wiring works) but blank until loadSheet/autoCreate finishes —
           without this overlay the first paint looks like a deleted sheet
           for the first 100–500 ms on slow networks. -->
      <div v-if="isInitialLoad" class="sn-canvas-loading" aria-busy="true">
        <Spinner class="sn-canvas-loading-spinner" />
      </div>

<!-- Non-blocking spinner while a large pivot aggregates in the background. -->
      <div v-if="pivotBuilding" class="sn-pivot-building" aria-busy="true">
        <Spinner class="sn-canvas-loading-spinner" />
        <span>Building pivot…</span>
      </div>

<!-- Floating charts (filtered to current sub-sheet by the overlay). -->
      <ChartOverlay
        :charts="chartList"
        :current-sheet="currentSheet"
        :get-matrix="getChartMatrix"
        :data-version="chartDataVersion"
        :selected-id="selectedChartId"
        :suppressed="chartDialogOpen"
        @select="selectChart"
        @edit="openChartEdit"
        @delete="onChartDelete"
        @refresh="onChartRefresh"
        @move="onChartMove"
        @resize="onChartResize"
      />

      <VersionHistory
        :open="vhOpen"
        :versions="vhVersions"
        :loading="vhLoading"
        :error="vhError"
        :active-version="vhActive"
        @close="closeVersionHistory"
        @select="previewVersion"
        @name="nameVersionInline"
        @copy="makeACopyInline"
        @restore="restoreVersionInline"
      />

      <!-- Notes side panel — Google-Sheets-style global list. Lives inside
           sn-grid-wrap so it docks the same right edge as Version History. -->
      <aside v-if="notesPanel.open" class="sn-notes-panel" @click.stop>
        <header class="sn-notes-header">
          <div class="sn-notes-title">
            Notes
            <span v-if="allNotes.length" class="sn-notes-count">· {{ allNotes.length }}</span>
          </div>
          <Button variant="ghost" size="sm" icon="lucide-x" @click="notesPanel.open = false" />
        </header>
        <div class="sn-notes-toolbar">
          <Button size="sm" variant="subtle" iconLeft="lucide-plus"
                  :label="`Add note to ${activeCell}`" @click="addNoteFromPanel" />
        </div>
        <div v-if="!allNotes.length" class="sn-notes-empty">
          <div class="sn-notes-empty-title">No notes yet.</div>
          <div class="sn-notes-empty-hint">
            Select a cell and press <KeyboardShortcut combo="Shift+F2" />, or use
            the button above. Notes appear here once added.
          </div>
        </div>
        <div v-else class="sn-notes-list">
          <div v-for="g in notesGrouped" :key="g.sheet" class="sn-notes-group">
            <div class="sn-notes-group-h">{{ g.sheet }}</div>
            <div v-for="n in g.items" :key="g.sheet + ':' + n.id"
                 class="sn-notes-row"
                 :class="{ 'sn-notes-row-active': n.sheet === currentSheet && n.id === activeCell }"
                 @click="jumpToNote(n)">
              <div class="sn-notes-row-ref">{{ n.id }}</div>
              <div class="sn-notes-row-text">{{ n.text }}</div>
            </div>
          </div>
        </div>
      </aside>

      <CellHistoryPopover
        v-model="cellHistory.open"
        :cell-ref="cellHistory.cell"
        :entries="cellHistory.entries"
        :loading="cellHistory.loading"
        :error="cellHistory.error"
      />

      <SplitTextPopover
        :open="splitText.open"
        :anchor="splitText.anchor"
        :selected="splitText.choice"
        @choose="onSplitChoose"
        @apply="onSplitApply"
        @cancel="onSplitCancel"
      />

      <LinkPreviewCard
        :open="linkCard.open"
        :anchor="linkCard.anchor"
        :url="linkCard.url"
        :preview="linkCard.preview"
        :can-edit="!readOnly"
        :offer-replace="linkCard.offerReplace"
        @enter="onLinkCardEnter"
        @leave="onLinkCardLeave"
        @open="openLinkCardUrl"
        @edit="editLinkCardCell"
        @unlink="unlinkLinkCardCell"
        @replace="replaceLinkWithTitle"
      />

      <!-- Outline around the active filter's range so its extent is visible.
           pointer-events:none keeps clicks reaching the canvas underneath. -->
      <div
        v-if="filterHighlightStyle"
        class="sn-filter-range"
        :style="filterHighlightStyle"
        aria-hidden="true"
      />

      <!-- Filter chevrons on row 0 (the user's header row of data) -->
      <div v-if="showSortFilter" class="sn-filter-overlay">
        <button
          v-for="col in visibleFilterCols"
          :key="col.col"
          class="sn-filter-btn"
          :class="{ active: filterConfig[col.col] }"
          :style="col.style"
          @click="openFilterPanel(col.col)"
        >
          <FeatherIcon name="chevron-down" class="sn-filter-btn-icon" />
        </button>
      </div>

      <!-- Remote cursor overlays — one per peer on the same sub-sheet.
           `data-moved` flips when the peer's (row,col) actually changes so
           the CSS only animates left/top/width/height on real motion, not
           on the local viewport scroll. -->
      <div
        v-for="cur in visibleRemoteCursors"
        :key="cur.user"
        class="sn-remote-cursor"
        :class="{ 'sn-remote-cursor--moved': cur.justMoved }"
        :style="cur.style"
        :title="cur.fullName"
      >
        <span class="sn-remote-cursor-label">{{ cur.firstName }}</span>
      </div>

      <!-- Pivot highlight overlay — thin coloured border drawn over the
           pivot output range so users can tell it's a generated table.
           pointer-events:none so the canvas keeps receiving clicks. -->
      <div
        v-if="activePivotConfig && pivotHighlightStyle"
        class="sn-pivot-highlight"
        :style="pivotHighlightStyle"
        aria-hidden="true"
      />

      <!-- Pivot FAB — floats below the Grand Total row, like Google Sheets -->
      <Dropdown v-if="activePivotConfig && pivotFabStyle" :options="pivotBannerMenuOptions">
        <template #default="{ open }">
          <button class="sn-pivot-fab" :class="{ open }" :style="pivotFabStyle" title="Pivot table options">
            <FeatherIcon name="pencil" class="sn-pivot-fab-icon" />
          </button>
        </template>
      </Dropdown>

      <!-- Inline filter panel — sort + condition + Google-Sheets-style
           "Filter by values" checklist with search and Select all/Clear. -->
      <div v-if="filterPanel.open" class="sn-filter-panel" :style="filterPanelStyle">
        <div class="sn-fp-title">Column {{ colLabel(filterPanel.col) }}</div>
        <div class="sn-fp-row">
          <Button class="sn-fp-grow" size="sm" iconLeft="lucide-arrow-up"   label="A → Z" tooltip="Sort ascending"  @click="doSort(filterPanel.col, 'asc')" />
          <Button class="sn-fp-grow" size="sm" iconLeft="lucide-arrow-down" label="Z → A" tooltip="Sort descending" @click="doSort(filterPanel.col, 'desc')" />
        </div>

        <!-- Mode toggle: condition vs values. Labels are short ("Values" /
             "Condition") so both fit inside the 260 px panel at the default
             Button text-base size — the full "Filter by …" wording overflowed
             at this width. Both modes share the Apply/Clear actions at the
             bottom, so the user can flip between modes before committing. -->
        <div class="sn-fp-mode" role="tablist" aria-label="Filter mode">
          <Button
            class="sn-fp-grow"
            size="sm"
            :variant="filterPanel.mode === 'values' ? 'subtle' : 'ghost'"
            label="Values"
            @click="filterPanel.mode = 'values'"
          />
          <Button
            class="sn-fp-grow"
            size="sm"
            :variant="filterPanel.mode === 'condition' ? 'subtle' : 'ghost'"
            label="Condition"
            @click="filterPanel.mode = 'condition'"
          />
        </div>

        <!-- Filter by values -->
        <template v-if="filterPanel.mode === 'values'">
          <!-- When a search is active these act on the *shown* matches only
               (Google-Sheets behaviour). Relabel so it's obvious — otherwise
               "Clear" during a search reads as "clear everything" and silently
               leaves the hidden values checked. -->
          <div class="sn-fp-vlinks">
            <Button variant="ghost" size="sm" :label="valueSearchActive ? 'Select shown' : 'Select all'" @click="selectAllFilterValues" />
            <Button variant="ghost" size="sm" :label="valueSearchActive ? 'Clear shown'  : 'Clear'"      @click="clearAllFilterValues" />
            <span class="sn-fp-count">Displaying {{ filterPanel.valueSet.size }}</span>
          </div>
          <FormControl
            type="text"
            size="sm"
            v-model="filterPanel.valueSearch"
            placeholder="Search…"
          >
            <template #prefix>
              <FeatherIcon name="search" class="sn-fp-search-icon" />
            </template>
          </FormControl>
          <div class="sn-fp-values">
            <div
              v-for="v in filteredFilterValues"
              :key="v || '__blanks__'"
              class="sn-fp-value-row"
              @click="toggleFilterValue(v)"
            >
              <Checkbox
                :modelValue="filterPanel.valueSet.has(v)"
                @update:modelValue="toggleFilterValue(v)"
                @click.stop
              />
              <span class="sn-fp-value-text">{{ v === '' ? '(Blanks)' : v }}</span>
            </div>
            <div v-if="!filteredFilterValues.length" class="sn-fp-empty">No matching values</div>
          </div>
        </template>

        <!-- Filter by condition -->
        <template v-else>
          <FormControl
            type="select"
            size="sm"
            v-model="filterPanel.operator"
            :options="FILTER_OPERATOR_OPTIONS"
          />
          <FormControl
            v-if="!['empty','notempty'].includes(filterPanel.operator)"
            type="text"
            size="sm"
            v-model="filterPanel.value"
            placeholder="Value"
            @keydown.enter="applyFilter"
          />
        </template>

        <div class="sn-fp-actions">
          <Button class="sn-fp-grow" variant="solid" size="sm" label="Apply" @click="applyFilter" />
          <Button class="sn-fp-grow"                 size="sm" label="Clear" @click="clearFilterCol" />
          <Button class="sn-fp-grow"                 size="sm" label="Close" @click="filterPanel.open = false" />
        </div>
      </div>
    </div>

    <!-- Add-more-rows strip — only when the user has scrolled near the bottom -->
    <div v-if="showAddRows" class="sn-addrows">
      <span class="sn-addrows-label">Add</span>
      <input name="add-rows-count" class="sn-addrows-input" type="number" min="1" max="10000" v-model.number="addRowsCount" />
      <span class="sn-addrows-label">more rows at the bottom</span>
      <Button variant="subtle" size="sm" iconLeft="lucide-plus" label="Add" @click="doAddMoreRows" />
    </div>

    <!-- Bottom · sheet tabs + selection stats -->
    <div class="sn-bottom">
      <!-- Pinned outside the scroll track so it stays reachable no matter
           how many tabs there are. The wrapper owns the divider + margins so
           the Button itself stays a clean square pill (frappe-ui puts our
           `class` on the <button> root, so any spacing/border set on it would
           become part of the button's own hover box). -->
      <!-- Add-sheet is a mutation, so viewers don't get it — hide the whole
           wrapper (button + its divider) rather than leave a dead, greyed pill. -->
      <div v-if="!readOnly" class="sn-tab-add-wrap">
        <Button variant="ghost" size="sm" icon="lucide-plus" class="sn-tab-add" tooltip="Add sheet" @click="addSheet" />
      </div>
      <div class="sn-tabs-track">
        <div
          v-for="name in sheetNames"
          :key="name"
          class="sn-tab"
          :class="{
            'sn-tab--active':   name === currentSheet,
            'sn-tab--pivot':    isPivotSheet(name),
            'sn-tab-drag-over': tabDragOver === name && tabDragName !== name,
            'sn-tab--static':   readOnly,
          }"
          :draggable="!readOnly"
          @dragstart="onTabDragStart($event, name)"
          @dragend="onTabDragEnd"
          @dragover.prevent="onTabDragOver($event, name)"
          @drop.prevent="onTabDrop($event, name)"
        >
          <!-- One visual unit: label + chevron share a single pill background
               so they read as one button. The chevron — the tab-menu affordance
               — renders only when editable; a viewer has no tab actions, so it
               would be a dead button. Clicking the label switches sheets. -->
          <Button
            variant="ghost"
            size="sm"
            :iconLeft="isPivotSheet(name) ? 'lucide-layout' : undefined"
            :label="name"
            class="sn-tab-btn"
            @mousedown="onTabMousedown($event, name)"
            @click="onTabClick(name)"
            @dblclick="openRenameDialog(name)"
            @contextmenu.prevent="_onTabMenu($event, name)"
          />
          <Button
            v-if="!readOnly"
            variant="ghost"
            size="sm"
            icon="lucide-chevron-down"
            class="sn-tab-chevron"
            @click.stop="_onTabMenu($event, name)"
          />
          <!-- Peer dots — one colored circle per peer currently on this
               tab. Capped at 3 + a "+N" overflow so a busy tab doesn't
               blow out the tab's width. -->
          <span
            v-if="peersBySubSheet.get(name)?.length"
            class="sn-tab-peers"
          >
            <span
              v-for="p in peersBySubSheet.get(name).slice(0, 3)"
              :key="p.user"
              class="sn-tab-peer-dot"
              :style="{ '--rc': p.color }"
              :title="p.full_name"
            />
            <span
              v-if="peersBySubSheet.get(name).length > 3"
              class="sn-tab-peer-more"
              :title="`${peersBySubSheet.get(name).length - 3} more`"
            >+{{ peersBySubSheet.get(name).length - 3 }}</span>
          </span>
        </div>
      </div>

      <div v-if="selectionStats" class="sn-stats">
        <span v-if="selectionStats.count > 0">Count: {{ selectionStats.count }}</span>
        <span v-if="selectionStats.sum !== null">Sum: {{ formatStat(selectionStats.sum) }}</span>
        <span v-if="selectionStats.avg !== null">Avg: {{ formatStat(selectionStats.avg) }}</span>
      </div>
    </div>

    <!-- Sheet-tab context menu (rename / duplicate / delete) -->
    <div v-if="tabMenu.open" class="sn-ctx-menu" :style="{ left: tabMenu.x + 'px', bottom: tabMenu.bottom + 'px' }">
      <Button variant="ghost" size="sm" iconLeft="lucide-edit-2"  label="Rename"    @click="openRenameDialog(tabMenu.name)" />
      <Button variant="ghost" size="sm" iconLeft="lucide-copy"    label="Duplicate" @click="doDuplicateSheet(tabMenu.name)" />
      <Button variant="ghost" size="sm" :iconLeft="tabMenuSheetLocked() ? 'lucide-unlock' : 'lucide-lock'" :label="tabMenuSheetLocked() ? 'Unprotect sheet' : 'Protect sheet'" @click="toggleSheetProtection(tabMenu.name)" />
      <Button
        variant="ghost"
        size="sm"
        iconLeft="lucide-trash-2"
        label="Delete"
        :disabled="sheetNames.length <= 1"
        @click="doDeleteSheet(tabMenu.name)"
      />
    </div>

    <!-- Rename sheet dialog -->
    <Dialog v-model:open="showRenameDialog" title="Rename sheet" size="sm">
      <template #default>
        <FormControl ref="renameInputRef" v-model="renameValue" label="New name" placeholder="Sheet name" @keydown.enter="confirmRename" />
        <p v-if="renameError" class="sn-rename-err">{{ renameError }}</p>
      </template>
      <template #actions>
        <div class="flex flex-row-reverse gap-2">
          <Button variant="solid" @click="confirmRename">Rename</Button>
          <Button @click="showRenameDialog = false">Cancel</Button>
        </div>
      </template>
    </Dialog>

    <!-- Right-click context menu (cursor-anchored; uses Frappe UI Buttons internally) -->
    <div v-if="contextMenu.open" class="sn-ctx-menu"
         :style="contextMenu.useBottom
           ? { left: contextMenu.x + 'px', bottom: contextMenu.bottom + 'px', maxHeight: contextMenu.maxH + 'px' }
           : { left: contextMenu.x + 'px', top:    contextMenu.y      + 'px', maxHeight: contextMenu.maxH + 'px' }">

      <!-- Column-header menu -->
      <template v-if="contextMenu.mode === 'colHeader'">
        <Button variant="ghost" size="sm" iconLeft="lucide-arrow-left"  label="Insert column left"  @click="doInsertCol(false)" />
        <Button variant="ghost" size="sm" iconLeft="lucide-arrow-right" label="Insert column right" @click="doInsertCol(true)" />
        <Button variant="ghost" size="sm" iconLeft="lucide-plus"        label="Insert N columns…"   @click="openInsertMany('col', false)" />
        <Button variant="ghost" size="sm" iconLeft="lucide-trash-2"     label="Delete column"       @click="doDeleteCol()" />
        <hr class="sn-ctx-sep" />
        <Button v-if="contextMenu.targetCol > 0" variant="ghost" size="sm" iconLeft="lucide-chevron-left"  label="Move column left"  @click="doMoveColLeft()" />
        <Button variant="ghost" size="sm" iconLeft="lucide-chevron-right" label="Move column right" @click="doMoveColRight()" />
        <hr class="sn-ctx-sep" />
        <Button variant="ghost" size="sm" iconLeft="lucide-maximize-2"  label="Auto-fit width"      @click="doAutoFitCol()" />
        <Button variant="ghost" size="sm" iconLeft="lucide-eye-off"     label="Hide column"         @click="doHideCols()" />
        <Button v-if="manualHiddenCols.size > 0" variant="ghost" size="sm" iconLeft="lucide-eye" label="Unhide all columns" @click="doUnhideAllCols()" />
        <hr class="sn-ctx-sep" />
        <Button variant="ghost" size="sm" iconLeft="lucide-lock"        label="Freeze up to this column" @click="doFreezeCol()" />
        <Button v-if="freezeCols > 0" variant="ghost" size="sm" iconLeft="lucide-unlock" label="Unfreeze columns" @click="doUnfreezeCols()" />
      </template>

      <!-- Row-header menu -->
      <template v-else-if="contextMenu.mode === 'rowHeader'">
        <Button variant="ghost" size="sm" iconLeft="lucide-arrow-up"    label="Insert row above" @click="doInsertRow(false)" />
        <Button variant="ghost" size="sm" iconLeft="lucide-arrow-down"  label="Insert row below" @click="doInsertRow(true)" />
        <Button variant="ghost" size="sm" iconLeft="lucide-plus"        label="Insert N rows…"   @click="openInsertMany('row', false)" />
        <Button variant="ghost" size="sm" iconLeft="lucide-trash-2"     label="Delete row"       @click="doDeleteRow()" />
        <hr class="sn-ctx-sep" />
        <Button variant="ghost" size="sm" iconLeft="lucide-maximize-2"  label="Auto-fit height"  @click="doAutoFitRow()" />
        <Button variant="ghost" size="sm" iconLeft="lucide-eye-off"     label="Hide row"         @click="doHideRows()" />
        <Button v-if="manualHiddenRows.size > 0" variant="ghost" size="sm" iconLeft="lucide-eye" label="Unhide all rows" @click="doUnhideAllRows()" />
        <hr class="sn-ctx-sep" />
        <Button variant="ghost" size="sm" iconLeft="lucide-lock"        label="Freeze up to this row" @click="doFreezeRow()" />
        <Button v-if="freezeRows > 0" variant="ghost" size="sm" iconLeft="lucide-unlock" label="Unfreeze rows" @click="doUnfreezeRows()" />
      </template>

      <!-- Cell menu (default) -->
      <template v-else>
        <Button v-if="clipboardHas" variant="ghost" size="sm" iconLeft="lucide-clipboard" label="Paste values only"  @click="doPasteSpecial('values')" />
        <Button v-if="clipboardHas" variant="ghost" size="sm" iconLeft="lucide-clipboard" label="Paste formats only" @click="doPasteSpecial('formats')" />
        <Button v-if="clipboardHas" variant="ghost" size="sm" iconLeft="lucide-clipboard" label="Paste formulas only" @click="doPasteSpecial('formulas')" />
        <hr v-if="clipboardHas" class="sn-ctx-sep" />
        <Button variant="ghost" size="sm" iconLeft="lucide-arrow-up"    label="Insert row above"     @click="doInsertRow(false)" />
        <Button variant="ghost" size="sm" iconLeft="lucide-arrow-down"  label="Insert row below"     @click="doInsertRow(true)" />
        <Button variant="ghost" size="sm" iconLeft="lucide-trash-2"     label="Delete row"           @click="doDeleteRow()" />
        <hr class="sn-ctx-sep" />
        <Button variant="ghost" size="sm" iconLeft="lucide-arrow-left"  label="Insert column left"   @click="doInsertCol(false)" />
        <Button variant="ghost" size="sm" iconLeft="lucide-arrow-right" label="Insert column right"  @click="doInsertCol(true)" />
        <Button variant="ghost" size="sm" iconLeft="lucide-trash-2"     label="Delete column"        @click="doDeleteCol()" />
        <hr class="sn-ctx-sep" />
        <Button variant="ghost" size="sm" iconLeft="lucide-lock"        label="Freeze rows to here"  @click="doFreezeRow()" />
        <Button v-if="freezeRows > 0" variant="ghost" size="sm" iconLeft="lucide-unlock" label="Unfreeze rows" @click="doUnfreezeRows()" />
        <Button variant="ghost" size="sm" iconLeft="lucide-lock"        label="Freeze cols to here"  @click="doFreezeCol()" />
        <Button v-if="freezeCols > 0" variant="ghost" size="sm" iconLeft="lucide-unlock" label="Unfreeze cols" @click="doUnfreezeCols()" />
        <hr class="sn-ctx-sep" />
        <Button variant="ghost" size="sm" iconLeft="lucide-square-check"   label="Data validation…" @click="contextMenu.open=false; openValidationDialog()" />
        <Button variant="ghost" size="sm" iconLeft="lucide-blend"          label="Conditional format…" @click="contextMenu.open=false; openCfDialog(null)" />
        <Button v-if="!selectionHasProtectedRange()" variant="ghost" size="sm" iconLeft="lucide-lock"   label="Protect range"     @click="protectSelection()" />
        <Button v-else                               variant="ghost" size="sm" iconLeft="lucide-unlock" label="Remove protection" @click="unprotectSelection()" />
        <hr class="sn-ctx-sep" />
        <Button variant="ghost" size="sm" iconLeft="lucide-columns"        label="Split text to columns" @click="doSplitTextToColumns()" />
        <hr class="sn-ctx-sep" />
        <Button variant="ghost" size="sm" iconLeft="lucide-layout"         label="Insert pivot table…"   @click="openPivotDialog()" />
        <Button variant="ghost" size="sm" iconLeft="lucide-chart-bar"    label="Insert chart…"          @click="openChartDialog()" />
        <Button variant="ghost" size="sm" iconLeft="lucide-filter"         label="Insert slicer"          @click="insertSlicer()" />
      </template>

    </div>

    <!-- Pivot dialog -->
    <PivotDialog
      v-model="pivotDialogOpen"
      :sheet="sheet"
      :current-sheet="currentSheet"
      :initial-range="pivotInitialRange"
      :pivot-id="pivotEditId"
      :existing-config="pivotEditConfig"
      @confirm="onPivotConfirm"
    />

    <!-- Chart dialog -->
    <ChartDialog
      v-model="chartDialogOpen"
      :sheet="sheet"
      :current-sheet="currentSheet"
      :initial-range="chartInitialRange"
      :chart-id="chartEditId"
      :existing-config="chartEditConfig"
      @confirm="onChartConfirm"
    />

    <!-- Named ranges dialog -->
    <NamedRangesDialog
      v-model="namedRangesDialogOpen"
      :named-ranges="namedRanges"
      :sheet-names="sheetNames"
      :current-sheet="currentSheet"
      @changed="_onNamedRangesChanged"
    />

    <!-- Share dialog -->
    <ShareDialog
      v-model="shareOpen"
      :sheet-id="props.id"
      :sheet-title="currentTitle"
      :owner-id="sheetOwner || userEmail"
      @shares-changed="shareCount = $event"
    />

    <!-- AI Assist settings (in-app, never the desk form) -->
    <AISettingsDialog v-model="aiSettingsOpen" @saved="onAiSettingsSaved" />

    <!-- AI Assist "Ask" command bar -->
    <AskBar
      v-if="askOpen"
      :busy="askBusy"
      :selection-label="askSelectionLabel"
      :error="askError"
      :answer="askAnswer"
      :pending="aiPending"
      @submit="onAskSubmit"
      @keep="onAskKeep"
      @undo="onAskUndo"
      @close="closeAskBar"
    />

    <!-- Find & Replace panel -->
    <FindReplace
      v-if="showFindReplace"
      ref="findReplaceRef"
      :sheet="sheet"
      :grid="grid"
      :is-protected="(id) => _cellSilentlyProtected(id)"
      @close="showFindReplace = false; canvasRef?.focus?.()"
      @navigate-to="onNavigateTo"
    />

    <!-- Cmd+K command palette -->
    <CommandPalette v-model:open="showCmdPalette" v-model:query="cmdQuery" @select="onCmdSelect">
      <CommandPaletteInput placeholder="Search commands" />
      <CommandPaletteList>
        <CommandPaletteGroup v-for="group in cmdGroups" :key="group.title" :label="group.title">
          <CommandPaletteItem v-for="item in group.items" :key="item.name" :value="item">
            {{ item.title }}
            <template v-if="item.description" #suffix>{{ item.description }}</template>
          </CommandPaletteItem>
        </CommandPaletteGroup>
      </CommandPaletteList>
      <CommandPaletteEmpty />
    </CommandPalette>

    <!-- Hyperlink dialog (Ctrl+L) — stores fmt.hyperlink on the active cell -->
    <Dialog v-model:open="showHyperlinkDialog" title="Insert hyperlink" size="sm">
      <template #default>
        <div class="sn-form-stack">
          <FormControl v-model="hyperlinkText" label="Display text" placeholder="Click here" />
          <FormControl v-model="hyperlinkUrl"  label="Link URL" placeholder="https://example.com" @keydown.enter="confirmHyperlink" />
        </div>
      </template>
      <template #actions>
        <div class="flex flex-row-reverse gap-2">
          <Button variant="solid" @click="confirmHyperlink">Apply</Button>
          <Button v-if="hasActiveHyperlink" theme="red" @click="removeHyperlink">Remove</Button>
          <Button @click="showHyperlinkDialog = false">Cancel</Button>
        </div>
      </template>
    </Dialog>

    <!-- Data validation dialog -->
    <Dialog v-model:open="validationDialog.open" title="Data validation" size="sm">
      <template #default>
        <div class="sn-form-stack">
          <!-- Type -->
          <FormControl type="select" label="Type" v-model="validationDialog.type"
            :options="[
              { label: 'Checkbox',       value: 'checkbox' },
              { label: 'List of items',  value: 'list' },
              { label: 'Number',         value: 'number' },
              { label: 'Text length',    value: 'text_length' },
            ]"
          />

          <!-- List — one row per item: a colour swatch, the label, and remove.
               Paste a comma/newline list into any field to split it into rows. -->
          <div v-if="validationDialog.type === 'list'" class="sn-vd-list" ref="vdListEl">
            <label class="sn-vd-list-label">Items</label>
            <div v-for="(item, i) in validationDialog.listItems" :key="i" class="sn-vd-item">
              <ColorPicker
                :model-value="item.color || ''"
                allow-default default-label="Automatic colour"
                :fallback="autoChipColor(i)" title="Label colour"
                @update:model-value="item.color = $event">
                <template #trigger="{ toggle, open }">
                  <button type="button" class="sn-vd-swatch" :class="{ 'is-open': open }"
                          :style="{ background: item.color || autoChipColor(i) }"
                          title="Label colour" @click="toggle()" />
                </template>
              </ColorPicker>
              <input class="sn-vd-item-input" v-model="item.label" placeholder="Item"
                     @keydown.enter.prevent="addListItem(i)"
                     @paste="onListPaste($event, i)" />
              <button type="button" class="sn-vd-item-x" title="Remove item"
                      @click="removeListItem(i)">
                <FeatherIcon name="x" class="sn-vd-item-xg" />
              </button>
            </div>
            <button type="button" class="sn-vd-add" @click="addListItem()">
              <FeatherIcon name="plus" class="sn-vd-add-g" /> Add item
            </button>
          </div>

          <!-- Operator (number / text_length) -->
          <FormControl v-if="['number','text_length'].includes(validationDialog.type)"
            type="select" label="Condition" v-model="validationDialog.operator"
            :options="[
              { label: 'Between',             value: 'between' },
              { label: 'Not between',         value: 'not_between' },
              { label: 'Greater than',        value: 'gt' },
              { label: 'Greater than or equal', value: 'gte' },
              { label: 'Less than',           value: 'lt' },
              { label: 'Less than or equal',  value: 'lte' },
              { label: 'Equal to',            value: 'eq' },
              { label: 'Not equal to',        value: 'neq' },
            ]"
          />

          <!-- Values -->
          <div v-if="['number','text_length'].includes(validationDialog.type)" class="sn-vd-vals">
            <FormControl
              v-model="validationDialog.val1"
              type="number"
              :label="['between','not_between'].includes(validationDialog.operator) ? 'Min' : 'Value'"
            />
            <FormControl
              v-if="['between','not_between'].includes(validationDialog.operator)"
              v-model="validationDialog.val2"
              type="number"
              label="Max"
            />
          </div>

          <!-- Custom error message -->
          <FormControl
            v-model="validationDialog.message"
            label="Error message (optional)"
            placeholder="This value is not allowed"
          />

          <!-- On invalid: block the edit, or allow it with a warning -->
          <FormControl v-if="validationDialog.type !== 'checkbox'"
            type="select" label="When the value is invalid" v-model="validationDialog.severity"
            :options="[
              { label: 'Reject the input',        value: 'reject' },
              { label: 'Allow, but show a warning', value: 'warn' },
            ]"
          />
        </div>
      </template>
      <template #actions>
        <div class="flex flex-row-reverse gap-2">
          <Button variant="solid" @click="confirmValidation">Apply</Button>
          <Button variant="ghost" theme="red" @click="removeValidation">Remove rule</Button>
          <Button @click="validationDialog.open = false">Cancel</Button>
        </div>
      </template>
    </Dialog>

    <!-- Insert N rows / columns dialog -->
    <Dialog v-model:open="showInsertManyDialog" :title="insertMany.kind === 'row' ? 'Insert rows' : 'Insert columns'" size="sm">
      <template #default>
        <FormControl
          v-model.number="insertMany.count"
          type="number"
          :min="1"
          :max="1000"
          :label="insertMany.kind === 'row' ? 'Number of rows' : 'Number of columns'"
          @keydown.enter="confirmInsertMany"
        />
      </template>
      <template #actions>
        <div class="flex flex-row-reverse gap-2">
          <Button variant="solid" @click="confirmInsertMany">Insert</Button>
          <Button @click="showInsertManyDialog = false">Cancel</Button>
        </div>
      </template>
    </Dialog>

    <!-- Custom number-format dialog -->
    <Dialog v-model:open="customFormatDialog.open" title="Custom number format" size="sm">
      <template #default>
        <div class="sn-form-stack">
          <FormControl
            v-model="customFormatDialog.pattern"
            label="Format code"
            placeholder="#,##0.00"
            @keydown.enter="confirmCustomFormat"
          />
          <div class="text-sm text-ink-gray-6">
            Preview: <span class="font-medium text-ink-gray-9">{{ customFormatPreview || '—' }}</span>
          </div>
          <div class="text-xs text-ink-gray-5 leading-relaxed">
            <code>0</code> padded digit · <code>#</code> optional digit · <code>,</code> thousands ·
            <code>.</code> decimal · <code>%</code> percent · <code>"text"</code> literal.
            e.g. <code>#,##0.00</code>, <code>0.0%</code>, <code>"$"#,##0</code>
          </div>
        </div>
      </template>
      <template #actions>
        <div class="flex flex-row-reverse gap-2">
          <Button variant="solid" @click="confirmCustomFormat">Apply</Button>
          <Button @click="customFormatDialog.open = false">Cancel</Button>
        </div>
      </template>
    </Dialog>

    <!-- Keyboard shortcut help — frappe-ui's KeyboardShortcutsModal, generated
         from the shortcut registry populated by useShortcuts.js (via useShortcut),
         so it can never drift from the handlers. -->
    <KeyboardShortcutsDialog v-model:open="showShortcutsHelp" title="Keyboard shortcuts" />

    <!-- Slicers — floating value-filter controls bound to a filter column -->
    <div v-for="sl in activeSlicers" :key="sl.id" class="sn-slicer"
         :style="{ left: sl.x + 'px', top: sl.y + 'px' }">
      <div class="sn-slicer-head" @mousedown="startSlicerDrag(sl, $event)">
        <Dropdown :options="slicerColMenu(sl)" class="sn-slicer-colsel">
          <template #default="{ open }">
            <Button :variant="open ? 'subtle' : 'ghost'" size="sm" iconRight="lucide-chevron-down"
                    :label="sl.label" tooltip="Filter column"
                    @mousedown.stop @click.stop />
          </template>
        </Dropdown>
        <Button variant="ghost" size="sm" icon="lucide-x" tooltip="Remove slicer"
                @mousedown.stop @click="removeSlicer(sl)" />
      </div>
      <div class="sn-fp-vlinks sn-slicer-actions" @mousedown.stop>
        <Button variant="ghost" size="sm" label="Select all" @click="selectAllSlicer(sl)" />
        <Button variant="ghost" size="sm" label="Clear" @click="clearSlicerValues(sl)" />
      </div>
      <div class="sn-slicer-values">
        <div v-for="row in sl.rows" :key="'v:' + row.v"
             class="sn-fp-value-row" @click="toggleSlicerValue(sl, row.v)">
          <Checkbox :modelValue="row.checked" @update:modelValue="toggleSlicerValue(sl, row.v)" @click.stop />
          <span class="sn-fp-value-text">{{ row.v === '' ? '(Blanks)' : row.v }}</span>
        </div>
      </div>
    </div>

    <!-- Threaded comment panel (floating near cell) -->
    <div v-if="commentPanel.open" class="sn-comment-panel"
         :style="{ left: commentPanel.x + 'px', top: commentPanel.y + 'px' }">
      <div class="sn-comment-header">
        <span class="sn-comment-title">
          Comment
          <span v-if="commentPanel.resolved" class="sn-comment-resolved">Resolved</span>
        </span>
        <div class="sn-comment-hactions">
          <Button v-if="commentPanel.thread.length" variant="ghost" size="sm"
                  :icon="commentPanel.resolved ? 'lucide-rotate-ccw' : 'lucide-check'"
                  :tooltip="commentPanel.resolved ? 'Reopen' : 'Mark resolved'"
                  @click="toggleResolveComment" />
          <Button variant="ghost" size="sm" icon="lucide-x" @click="commentPanel.open = false" />
        </div>
      </div>

      <div v-if="commentPanel.thread.length" class="sn-comment-thread">
        <div v-for="(r, i) in commentPanel.thread" :key="`${r.ts}-${r.author}`" class="sn-comment-reply">
          <div class="sn-comment-reply-head">
            <span class="sn-comment-author">{{ r.name || r.author || 'Someone' }}</span>
            <span class="sn-comment-time">{{ commentTime(r.ts) }}</span>
            <Button v-if="r.author && r.author === userEmail" variant="ghost" size="sm" icon="lucide-trash-2"
                    tooltip="Delete" class="sn-comment-del" @click="deleteCommentReply(i)" />
          </div>
          <div class="sn-comment-text">{{ r.text }}</div>
        </div>
      </div>

      <textarea class="sn-comment-ta" v-model="commentPanel.draft" rows="2"
                :placeholder="commentPanel.thread.length ? 'Reply…' : 'Add a comment…'"
                @keydown.enter.exact.prevent="addCommentReply" />
      <div class="sn-comment-actions">
        <Button size="sm" variant="solid" :disabled="!commentPanel.draft.trim()" @click="addCommentReply">
          {{ commentPanel.thread.length ? 'Reply' : 'Comment' }}
        </Button>
        <Button v-if="commentPanel.thread.length" size="sm" variant="ghost" theme="red" @click="deleteComment">Delete all</Button>
      </div>
    </div>

    <!-- Validation dropdown panel -->
    <div v-if="dropdownPanel.open" class="sn-dropdown-panel"
         :style="{ left: dropdownPanel.x + 'px', top: dropdownPanel.y + 'px', minWidth: dropdownPanel.w + 'px' }">
      <div v-for="opt in dropdownPanel.options" :key="opt"
           class="sn-dropdown-opt" :class="{ 'is-active': opt === dropdownPanel.value }"
           @mousedown.prevent="pickDropdownOption(opt)">
        <FeatherIcon name="check" class="sn-dropdown-check" :style="{ visibility: opt === dropdownPanel.value ? 'visible' : 'hidden' }" />
        <span class="sn-dropdown-chip" :style="{ background: chipColor(opt, dropdownPanel.rule) }">{{ opt }}</span>
      </div>
      <div v-if="dropdownPanel.value" class="sn-dropdown-opt sn-dropdown-clear"
           @mousedown.prevent="pickDropdownOption('')">
        <FeatherIcon name="x" class="sn-dropdown-check" />
        <span class="sn-dropdown-label">Clear</span>
      </div>
    </div>

    <!-- Conditional formatting dialog -->
    <Dialog v-model:open="cfDialog.open" title="Conditional formatting" size="sm">
      <template #default>
        <div class="sn-form-stack">
          <!-- Existing rules — click to edit, ✕ to delete. Only shown when
               the active sheet has any rules; otherwise we jump straight to
               the editor for the new rule. -->
          <div v-if="cfRulesForSheet.length" class="sn-cf-rule-list">
            <div class="sn-cf-rule-list-title">Rules on this sheet</div>
            <div v-for="r in cfRulesForSheet" :key="r.id" class="sn-cf-rule-row"
                 :class="{ 'sn-cf-rule-row--active': cfDialog.editId === r.id }">
              <button type="button" class="sn-cf-rule-pick" @click="openCfDialog(r.id)">
                {{ cfRuleLabel(r) }}
              </button>
              <Button variant="ghost" size="sm" icon="lucide-x" theme="red"
                      @click="deleteCfRuleById(r.id)" tooltip="Delete rule" />
            </div>
          </div>

          <FormControl type="select" label="Rule type" v-model="cfDialog.kind" :options="CF_KIND_OPTIONS" />

          <!-- Classic single-colour rule (the original feature). -->
          <template v-if="cfDialog.kind === 'classic'">
            <FormControl type="select" label="Condition" v-model="cfDialog.condType" :options="CF_COND_OPTIONS" />
            <FormControl v-if="!['empty','notempty'].includes(cfDialog.condType)"
                         v-model="cfDialog.condValue" label="Value" placeholder="e.g. 0" />
            <FormControl v-if="cfDialog.condType === 'between'"
                         v-model="cfDialog.condValue2" label="And" placeholder="e.g. 100" />
            <div class="sn-cf-fmt">
              <ColorPicker v-model="cfDialog.fmtColor" allow-default default-label="Automatic" title="Text colour" fallback="#171717">
                <template #trigger="{ toggle, open }">
                  <button type="button" class="sn-swatch-btn" :class="{ 'is-open': open }" title="Text colour" @click="toggle()">
                    <FeatherIcon name="type" class="sn-swatch-glyph" />
                    <span class="sn-swatch-underline" :style="{ background: cfDialog.fmtColor || '#171717' }"></span>
                  </button>
                </template>
              </ColorPicker>
              <ColorPicker v-model="cfDialog.fmtBg" allow-default default-label="No fill" title="Fill colour" fallback="#ffffff">
                <template #trigger="{ toggle, open }">
                  <button type="button" class="sn-swatch-btn" :class="{ 'is-open': open }" title="Fill colour" @click="toggle()">
                    <FeatherIcon name="droplet" class="sn-swatch-glyph" />
                    <span class="sn-swatch-underline sn-swatch-fill" :style="{ background: cfDialog.fmtBg || '#ffffff' }"></span>
                  </button>
                </template>
              </ColorPicker>
              <span class="sn-cf-fmt-label">Apply to range: {{ cfRangeLabel }}</span>
            </div>
          </template>

          <!-- Colour scale: 2- or 3-stop gradient mapped across the range's min/max. -->
          <template v-else-if="cfDialog.kind === 'color-scale'">
            <FormControl type="select" label="Variant" v-model="cfDialog.scaleVariant" :options="CF_SCALE_VARIANT_OPTIONS" />
            <div class="sn-cf-scale">
              <div class="sn-cf-stop">
                <span>Min</span>
                <ColorPicker v-model="cfDialog.scaleMin" title="Min colour" :fallback="cfDialog.scaleMin" />
              </div>
              <div v-if="cfDialog.scaleVariant === '3color'" class="sn-cf-stop">
                <span>Mid</span>
                <ColorPicker v-model="cfDialog.scaleMid" title="Mid colour" :fallback="cfDialog.scaleMid" />
              </div>
              <div class="sn-cf-stop">
                <span>Max</span>
                <ColorPicker v-model="cfDialog.scaleMax" title="Max colour" :fallback="cfDialog.scaleMax" />
              </div>
            </div>
            <div
              class="sn-cf-scale-preview"
              :style="{ background: cfDialog.scaleVariant === '3color'
                ? `linear-gradient(90deg, ${cfDialog.scaleMin}, ${cfDialog.scaleMid}, ${cfDialog.scaleMax})`
                : `linear-gradient(90deg, ${cfDialog.scaleMin}, ${cfDialog.scaleMax})` }"
            />
            <span class="sn-cf-fmt-label">Apply to range: {{ cfRangeLabel }}</span>
          </template>

          <!-- Data bars: horizontal bar inside each cell, proportional to value. -->
          <template v-else-if="cfDialog.kind === 'data-bar'">
            <div class="sn-cf-stop">
              <span>Bar colour</span>
              <ColorPicker v-model="cfDialog.barColor" title="Bar colour" :fallback="cfDialog.barColor" />
            </div>
            <div class="sn-cf-bar-preview">
              <div class="sn-cf-bar-row" v-for="t in [0.25, 0.5, 0.85]" :key="t">
                <div class="sn-cf-bar-fill" :style="{ width: (t * 100) + '%', background: cfDialog.barColor }" />
              </div>
            </div>
            <span class="sn-cf-fmt-label">Apply to range: {{ cfRangeLabel }}</span>
          </template>

          <!-- Icon sets: small icons at the start of each cell based on bucket. -->
          <template v-else-if="cfDialog.kind === 'icon-set'">
            <FormControl type="select" label="Icon set" v-model="cfDialog.iconSet" :options="CF_ICON_SET_OPTIONS" />
            <span class="sn-cf-fmt-label">Apply to range: {{ cfRangeLabel }}</span>
            <p class="sn-cf-hint">Values are split into three equal buckets across the range.</p>
          </template>
        </div>
      </template>
      <template #actions>
        <div class="flex flex-row-reverse gap-2">
          <Button variant="solid" @click="saveCfRule">Apply</Button>
          <Button v-if="cfDialog.editId !== null" theme="red" @click="deleteCfRule">Delete</Button>
          <Button @click="cfDialog.open = false">Cancel</Button>
        </div>
      </template>
    </Dialog>

    </template>
  </div>
</template>

<script setup>
import { h, ref, reactive, computed, customRef, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { createGrid }          from '../../canvas/index.js'
import { COL_HEADER_H, ROW_HEADER_W } from '../../canvas/constants.js'
import { colLabel, parseCellId, cellId } from '../../utils/cells.js'
import { call } from '../../utils/api.js'
import { useCurrentUser, useSessionStore } from '@/boot/session'
import { useAppSwitcher } from '@/composables/useAppSwitcher'
import { useThemeMenuOption } from '@/composables/useThemeMenuOption'
import { userInitials } from '../../utils/session.js'
import { parseNumberFmt, buildNumberFmt, applyNumberFmt } from '../../utils/format-number.js'
import { getTextWrap } from '../../utils/text-wrap.js'
import { autoCloseKey } from '../../utils/formula-autoclose.js'
import { overlayRectStyle } from '../../utils/overlay-rect.js'
import { isCanvasClipboardTarget } from '../../utils/clipboard-target.js'
import { computeFillDown, computeFillRight } from '../../engine/fill-series.js'
import { detectSeries }                       from '../../engine/patterns/index.js'
import { adjustFormula }                    from '../../engine/formula-adjust.js'
import { moveMap, insertMap, deleteMap }    from '../../engine/ref-remap.js'
import { createSheet }         from '../../engine/sheet.js'
import { createHistory }       from '../../engine/history.js'
import { createFormatsEngine } from '../../engine/formats.js'
import { formatScope }         from '../../engine/format-scope.js'
import { createMergeEngine }   from '../../engine/merge.js'
import { createClipboard }     from '../../engine/clipboard.js'
import { createSortFilter }    from '../../engine/sortFilter.js'
import { createSlicerEngine }  from '../../engine/slicers.js'
import { createCommentsEngine }  from '../../engine/comments.js'
import { createValidationEngine } from '../../engine/validation.js'
import { createProtectionEngine } from '../../engine/protection.js'
import { chipColor, chipPaletteColor } from '../../canvas/chip-geometry.js'
import { createCondFormatEngine } from '../../engine/cond-format.js'
import { detectHyperlink, isAutoLinkText } from '../../engine/links.js'
import { fetchLinkPreview } from '../../services/linkPreview.js'
import { useToolbar }          from './useToolbar.js'
import { usePersistence }      from './usePersistence.js'
import { useEditOps }          from './useEditOps.js'
import { useSheetTabs }        from './useSheetTabs.js'
import { useFormulaAutocomplete, AC_FUNS } from './useFormulaAutocomplete.js'
import { buildAlignOptions, buildBorderOptions, buildMoreToolbarOptions } from './toolbar.config.js'
import { useContextMenu } from './useContextMenu.js'
import { usePivotIntegration } from './usePivotIntegration.js'
import { useShortcuts } from './useShortcuts.js'
import { useCollaboration }    from './useCollaboration.js'
import { useExportImport }     from './useExportImport.js'
import { useVersionHistory }   from './useVersionHistory.js'
import { useSplitText }        from './useSplitText.js'
import { buildCommandGroups }  from './commandPalette.config.js'
import FindReplace             from './FindReplace.vue'
import VersionHistory          from './VersionHistory.vue'
import VersionPreviewBanner    from './VersionPreviewBanner.vue'
import CellHistoryPopover      from './CellHistoryPopover.vue'
import SplitTextPopover        from './SplitTextPopover.vue'
import LinkPreviewCard         from './LinkPreviewCard.vue'
import ShareDialog             from './ShareDialog.vue'
import AISettingsDialog        from './AISettingsDialog.vue'
import AskBar                  from './AskBar.vue'
import PivotDialog             from './PivotDialog.vue'
import ColorPicker             from './ColorPicker.vue'
import { createPivotEngine } from '../../engine/pivot.js'
import { createChartEngine } from '../../engine/charts.js'
import { useChartIntegration } from './useChartIntegration.js'
import ChartDialog             from './ChartDialog.vue'
import ChartOverlay            from './ChartOverlay.vue'
import InlineRenameInput       from '@/apps/drive/components/InlineRenameInput.vue'
import { createNamedRanges }   from '../../engine/named-ranges.js'
import { getFunctionNames }    from '../../engine/formula.js'
import NamedRangesDialog       from './NamedRangesDialog.vue'
import { useSmartFill }        from './useSmartFill.js'
import * as versionsApi        from '../../services/versions.js'
import {
   Avatar, Badge, Breadcrumbs, Button, Checkbox, Dialog, Dropdown, FormControl, KeyboardShortcut, KeyboardShortcutsDialog, Spinner, TextInput, Tooltip } from 'frappe-ui'
import {
  CommandPalette,
  CommandPaletteEmpty,
  CommandPaletteGroup,
  CommandPaletteInput,
  CommandPaletteItem,
  CommandPaletteList,
  Icon as FeatherIcon,
} from 'frappe-ui/experimental'

const props = defineProps({ id: { type: String, default: 'new' } })
const emit  = defineEmits(['close', 'saved'])
const sessionStore = useSessionStore()
const appsMenuOption = useAppSwitcher('sheets', async () => {
  await flushSave()
  return !saveError.value
})
const themeMenuOption = useThemeMenuOption()
const isTitleEditing = ref(false)
const sheetHomeBreadcrumbs = computed(() => [
  { label: 'Sheets', href: '/sheets', onClick: flushAndClose },
])
const sheetBreadcrumbs = computed(() => [
  ...sheetHomeBreadcrumbs.value,
  { label: currentTitle.value || 'Untitled Sheet', onClick: startTitleEditing },
])
const brandMenuOptions = computed(() => [
  {
    group: '',
    options: [appsMenuOption.value],
  },
  {
    group: '',
    options: [
      themeMenuOption,
      ...(sessionStore.isLoggedIn
        ? [{ label: 'Log out', icon: 'lucide-log-out', onClick: () => sessionStore.logout.submit() }]
        : []),
    ],
  },
])

// ── Engine instances ──────────────────────────────────────────────────────────

const sheet = createSheet({
  onCellChanged(id, displayValue) {
    // Range-scoped cond-format rules (color-scale, data-bar, icon-set) cache
    // per-rule min/max stats — any cell change can shift those bounds, so the
    // cache must be cleared before the next paint.
    condFormat?.invalidate()
    // A chart may source from this cell — bump the chart data version so the
    // overlay's matrix cache re-pulls. Drag/resize/scroll don't fire cell-change
    // callbacks, so those keep hitting the cache (the reason it exists).
    chartDataVersion.value++
    if (showFormulas.value) {
      grid?.setCell(id, String(sheet.getCell(id) ?? ''))
      return
    }
    const fmt = formats.get(id, sheet.getCurrentSheet())
    const displayed = fmt.numberFormat ? applyNumberFmt(displayValue, fmt.numberFormat) : displayValue
    grid?.setCell(id, displayed)
  },
  // Bulk-write callback. Two flavours:
  //   - `affected = null` — wholesale rewrite (import / load / restore).
  //     The whole sheet may have changed, so do a full _repopulateGrid.
  //   - `affected = Set<cellId>` — incremental write (paste, future
  //     fill/format ops). Only repaint the cells the engine flagged.
  //     For a paste of 50 cells in a 5k-cell sheet this is 50 grid
  //     updates instead of 5k, which is where the perf trace pinned
  //     onCellsChanged at 181 ms self time after the snapshot fix.
  onCellsChanged(_sheet, affected) {
    condFormat?.invalidate()
    // Source data for any chart may have moved — invalidate the overlay's matrix
    // cache (kept stale on drag/scroll, which don't reach this callback).
    chartDataVersion.value++
    if (!affected) { _repopulateGrid(); return }
    const sn = sheet.getCurrentSheet()
    for (const id of affected) {
      const fmt = formats.get(id, sn)
      const displayValue = sheet.getDisplayValue(id)
      grid?.setCell(id, fmt.numberFormat ? applyNumberFmt(displayValue, fmt.numberFormat) : displayValue)
    }
    // A bulk edit (paste/fill) can change a pivot's source data; recompute so
    // pivot output cells don't lag. affectsPivot() short-circuits when this
    // sheet feeds no pivot, keeping the cheap incremental path cheap.
    recomputePivotsForSheet(sn)
  },
})
const formats    = createFormatsEngine()
const merge      = createMergeEngine()
const sortFilter = createSortFilter(sheet)
const slicers    = createSlicerEngine()
const comments   = createCommentsEngine()
const validation = createValidationEngine()
const protection = createProtectionEngine()
const condFormat = createCondFormatEngine()
const clipboard  = createClipboard({
  sheet, formats, condFormat, validation, protection,
  // Late-bound to the pivot integration (declared below). Only invoked at
  // copy/paste time, long after setup runs, so the forward reference is safe.
  getPivotAt: (sel, sn) => getPivotAt(sel, sn),
  createPivotFromPaste: (blob, anchorId, sn) => createPastedPivot(blob, anchorId, sn),
})
const pivot      = createPivotEngine()
const charts     = createChartEngine()
// Named ranges: the validator hook prevents users from defining names that
// collide with the formula engine's built-in functions (SUM, VLOOKUP, etc.).
const _builtinFns = new Set(getFunctionNames())
const namedRanges = createNamedRanges({ isBuiltinFunction: n => _builtinFns.has(n) })

// Plug the named-range resolver into the sheet engine so `=Revenue` etc.
// resolve at evaluate-time without crossing engine boundaries via imports.
sheet.setNamedRangeResolver?.(name => namedRanges.resolve(name))

// Dialog state — toolbar / context-menu entries flip this open. Changes
// inside the dialog (add/edit/delete) mark the workbook dirty and push a
// history snapshot so undo/redo behaves predictably.
const namedRangesDialogOpen = ref(false)
function openNamedRangesDialog() {
  contextMenu.open = false
  namedRangesDialogOpen.value = true
}
function _onNamedRangesChanged() {
  // The engine notifies via onChange too, but we explicitly push history
  // here so each batched add/edit/delete becomes its own undoable event.
  history.push()
  isDirty.value = true
  // Names that map to range references can affect cell display via the
  // formula engine — repaint so any =Name cells refresh.
  _repopulateGrid()
}

// Smart Fill — Cmd/Ctrl+E. Looks at the user's example values in the
// selected column, detects a heuristic transform (case / concat / word /
// substring / email-part), and fills the rest.
const { runSmartFill: _runSmartFill } = useSmartFill({
  getSheet:        () => sheet,
  getGrid:         () => grid,
  queueOp:         (...a) => _queueOp(...a),
  captureRange:    (...a) => _captureRange(...a),
  diffRefs:        (...a) => _diffRefs(...a),
  getHistory:      () => history,
  getIsDirty:      () => isDirty,
  repopulateGrid:  () => _repopulateGrid(),
})
function runSmartFill() {
  const result = _runSmartFill()
  if (!result.ok) {
    // Hint the user when there's nothing to fill — quiet failure feels broken.
    const hints = {
      'single-column-only':  'Smart Fill works on a single column at a time.',
      'no-examples':         'Fill in 1–2 example cells first, then select the range and press Cmd+E.',
      'no-empty-cells':      'No empty cells in the selection to fill.',
      'no-source-columns':   'Smart Fill needs adjacent columns with source data.',
      'no-pattern':          "Couldn't detect a pattern from your examples.",
      'no-fills':            "Detected a pattern but couldn't apply it to any rows.",
    }
    saveError.value = hints[result.reason] || 'Smart Fill could not run.'
    setTimeout(() => { saveError.value = '' }, 3500)
  }
}

// Single source of truth for "what does undo restore?". Every engine that
// owns mutable state (sheet data, formats, merges, filters, comments,
// validations, conditional formats) plus the canvas-side view state (column
// widths, freeze, hidden rows/cols, zoom, total rows) is captured. Anything
// not snapshotted here is invisible to undo — that was the bug behind
// "filter doesn't undo".
const history = createHistory({
  snapshot() {
    return {
      sheet:        sheet.snapshot(),
      formats:      formats.snapshot(),
      merge:        merge.snapshot(),
      sortFilter:   sortFilter.snapshot(),
      slicers:      slicers.snapshot(),
      comments:     comments.snapshot(),
      validation:   validation.snapshot(),
      protection:   protection.snapshot(),
      condFormat:   condFormat.snapshot(),
      pivot:        pivot.snapshot(),
      charts:       charts.snapshot(),
      namedRanges:  namedRanges.snapshot(),
      view:         grid?.viewSnapshot?.() ?? null,
    }
  },
  restore(snap, opts = {}) {
    formats.restore(snap.formats)
    // Cell-level restore: in collab mode, the history hands us a `touches`
    // set listing exactly which cells THIS client touched in the undone
    // op. We revert only those — anything a remote peer changed in the
    // interim stays put. Non-collab mode (or initial snapshot with no
    // touches) falls back to the wholesale sheet.restore() to preserve
    // long-standing behaviour.
    if (opts.touches && opts.touches.size > 0) {
      _restoreTouchedCells(snap.sheet, opts.touches)
    } else {
      sheet.restore(snap.sheet)
    }
    if (snap.merge)       merge.restore(snap.merge)
    if (snap.sortFilter)  sortFilter.restore(snap.sortFilter)
    if (snap.slicers)     slicers.restore(snap.slicers)
    if (snap.comments)    comments.restore(snap.comments)
    if (snap.validation)  validation.restore(snap.validation)
    if (snap.protection)  protection.restore(snap.protection)
    if (snap.condFormat)  condFormat.restore(snap.condFormat)
    if (snap.pivot)       pivot.restore(snap.pivot)
    if (snap.charts)      charts.restore(snap.charts)
    if (snap.namedRanges) namedRanges.restore(snap.namedRanges)
    if (snap.view && grid?.viewRestore) grid.viewRestore(snap.view)
    // Caller (undo/redo) repopulates the canvas + reapplies hidden rows.
  },
  // Cheap op-based undo/redo. The op shape mirrors what _queueOp already
  // captures for server sync: a {opType, subSheet, before, after} diff over
  // a set of cell IDs. Undo writes `before` back; redo writes `after`.
  // Both go through sheet.setCell so the engine's notify cascade + memo
  // invalidation + collab Y.Doc mirror all stay in sync — same path a
  // human edit takes, just with the saved values.
  //
  // Paste-style ops carry additional optional maps:
  //   - beforeFormats / afterFormats — per-cell format snapshots
  //   - beforeValidation / afterValidation — per-cell validation rules
  // so the full paste effect (values + formats + validation) round-trips
  // through undo/redo without the 320 ms snapshot tax.
  revertOp(op) {
    // Structural op: undo of "add sheet" is just deleting the (empty) sheet.
    if (op.opType === 'sheet_add') { _deleteSheet(op.name); return }
    _applyCellMap(op.before, op.subSheet)
    if (op.beforeFormats)    _applyFormatMap(op.beforeFormats, op.subSheet)
    if (op.beforeCols)       _applyAxisFormatMap('col', op.beforeCols, op.subSheet)
    if (op.beforeRows)       _applyAxisFormatMap('row', op.beforeRows, op.subSheet)
    if (op.beforeValidation) _applyValidationMap(op.beforeValidation, op.subSheet)
    if (op.beforeMerge)      { merge.restore(op.beforeMerge); grid?.render?.() }
    if (op.beforeRowH)       _applyRowHeightMap(op.beforeRowH, op.subSheet)
  },
  applyOp(op) {
    // Structural op: redo of "add sheet" recreates the same empty sheet.
    if (op.opType === 'sheet_add') { _addSheet(op.name); return }
    _applyCellMap(op.after, op.subSheet)
    if (op.afterFormats)    _applyFormatMap(op.afterFormats, op.subSheet)
    if (op.afterCols)       _applyAxisFormatMap('col', op.afterCols, op.subSheet)
    if (op.afterRows)       _applyAxisFormatMap('row', op.afterRows, op.subSheet)
    if (op.afterValidation) _applyValidationMap(op.afterValidation, op.subSheet)
    if (op.afterMerge)      { merge.restore(op.afterMerge); grid?.render?.() }
    if (op.afterRowH)       _applyRowHeightMap(op.afterRowH, op.subSheet)
  },
  getLocalTouches: () => _drainCollabLocalTouches(),
})

// Used by op-based undo/redo to write a {cellId: value} diff back to the
// engine. Routes through the engine's bulk write so a big op (delete-all,
// 25k-cell paste) doesn't freeze the main thread the same way the import
// hot loop used to. For small ops the per-cell setCell path is still
// fine and keeps the collab Y.Doc mirror in sync; the batch path is only
// taken when the op is large enough that the per-cell cascade would be
// the bottleneck.
//
// Threshold is conservative — 25 cells is well below the point where
// per-cell setCell starts to feel slow, but above any typical single-cell
// edit so collab sync stays exact for normal undo/redo.
const _BATCH_THRESHOLD = 25
function _applyCellMap(map, sheetName) {
  if (!map) return
  const ids = Object.keys(map)
  if (ids.length === 0) return
  if (ids.length > _BATCH_THRESHOLD && sheet.batchSetCells) {
    sheet.batchSetCells(map, sheetName, { replace: false })
    return
  }
  for (const id of ids) sheet.setCell(id, map[id] ?? '', sheetName)
}

// Apply a {cellId: format|null} diff. Used by paste/fill undo/redo to
// revert format changes the user wouldn't get back from the cell-value
// diff alone. After mutating the store we manually push display strings
// for each affected cell — number format affects the rendered value, so
// the canvas needs the new strings for those cells. Validation doesn't
// affect the display string, so its apply is just the store mutation.
function _applyFormatMap(map, sheetName) {
  if (!map) return
  const sn = sheetName || sheet.getCurrentSheet()
  for (const [id, fmt] of Object.entries(map)) {
    if (fmt && Object.keys(fmt).length) formats.set(id, fmt, sn)
    else                                 formats.clear(id, sn)
  }
  for (const id of Object.keys(map)) {
    const f  = formats.get(id, sn)
    const dv = sheet.getDisplayValue(id, sn)
    grid?.setCell(id, f.numberFormat ? applyNumberFmt(dv, f.numberFormat) : dv)
  }
}

// Apply a { colIdx|rowIdx: format|null } diff to the column or row format
// layer (undo/redo of range-level formatting). Exact replacement, so undo
// restores the captured layer precisely. One render covers the whole axis.
function _applyAxisFormatMap(axis, map, sheetName) {
  if (!map) return
  const sn = sheetName || sheet.getCurrentSheet()
  const replace = axis === 'col' ? formats.replaceCol : formats.replaceRow
  for (const [k, fmt] of Object.entries(map)) replace(+k, fmt || {}, sn)
  grid?.render?.()
}

function _applyValidationMap(map, sheetName) {
  if (!map) return
  const sn = sheetName || sheet.getCurrentSheet()
  for (const [id, rule] of Object.entries(map)) {
    if (rule) validation.set(id, rule, sn)
    else      validation.clear(id, sn)
  }
  // Validation only affects the dropdown-arrow indicator the canvas
  // paints from getValidation each render — next paint picks it up.
  grid?.render?.()
}

// Apply a {row: height} diff from a multi-line-edit op. Row heights are
// canvas view state scoped to the current sheet, so cross-sheet undo skips
// them rather than resizing the wrong sheet's rows.
function _applyRowHeightMap(map, sheetName) {
  if ((sheetName || sheet.getCurrentSheet()) !== sheet.getCurrentSheet()) return
  for (const [r, h] of Object.entries(map)) grid?.setRowHeight?.(+r, h)
}

// Forward-declaration: `useCollaboration` (further down the script) sets
// `_collabDrainLocalTouches` to its real implementation once the binding
// is up. Before that, the history degrades cleanly to full-restore by
// returning an empty set.
let _collabDrainLocalTouches = () => new Set()
function _drainCollabLocalTouches() { return _collabDrainLocalTouches() }

// Revert just the cells in `touches` to their values from `sheetSnap`.
// `touches` is a Set of "sheetName|cellId" keys. Going through sheet.setCell
// keeps deps + the Y.Doc mirror + the engine notify-callbacks in sync, so
// peers see our undo as a regular write.
function _restoreTouchedCells(sheetSnap, touches) {
  const allSheets = sheetSnap?.sheets || sheetSnap || {}
  for (const key of touches) {
    const idx = key.indexOf('|')
    if (idx < 0) continue
    const sn = key.slice(0, idx)
    const id = key.slice(idx + 1)
    const original = allSheets[sn]?.[id] ?? ''
    sheet.setCell(id, original, sn)
  }
}

// ── Vue state ─────────────────────────────────────────────────────────────────

const canvasRef       = ref(null)
const gridWrapRef     = ref(null)
const formulaInputRef = ref(null)
const csvInputRef     = ref(null)
const xlsxInputRef    = ref(null)

const activeCell        = ref('A1')
const formulaValue      = ref('')
const canUndo           = ref(false)
const canRedo           = ref(false)
const currentTitle      = ref('Untitled Sheet')
const activeNumberFormat = ref('')

// Cross-sheet picker: when the user starts a `=…` edit in the top formula
// bar then clicks another sheet's tab, we keep the in-progress formula alive
// across the switch. These refs remember where to write the formula back on
// commit; null when no cross-sheet edit is in flight.
const editingHomeSheet = ref(null)
const editingHomeCell  = ref(null)
// Dropdown reflects the *type* only ('number' / 'currency' / ...), so a stored
// `number:3` still shows "Number" as selected.
const activeNumberFormatType = computed(() => parseNumberFmt(activeNumberFormat.value).type)
const showFindReplace   = ref(false)
const findReplaceRef    = ref(null)

function openFindReplace() {
  document.activeElement?.blur?.()
  showFindReplace.value = true
  const triggerFocus = () => findReplaceRef.value?.focusInput?.()
  nextTick(triggerFocus)
  setTimeout(triggerFocus, 0)
  setTimeout(triggerFocus, 50)
}

const showShortcutsHelp = ref(false)

const showInsertManyDialog = ref(false)
const insertMany           = reactive({ kind: 'row', count: 5, below: false })
const showHyperlinkDialog  = ref(false)
const hyperlinkText        = ref('')
const hyperlinkUrl         = ref('')
const hasActiveHyperlink   = computed(() => !!activeFormat.value?.hyperlink)
const showFormulas      = ref(false)

const selectionStats    = ref(null)
let _dirtyRevision = 0
const isDirty = customRef((track, trigger) => {
  let value = false
  return {
    get() {
      track()
      return value
    },
    set(next) {
      if (next) _dirtyRevision += 1
      if (next === value) return
      value = next
      trigger()
    },
  }
})
const isPaintingFormat  = ref(false)

// ── Comment UI state ──────────────────────────────────────────────────────────
const commentPanel  = reactive({ open: false, id: '', x: 0, y: 0, thread: [], resolved: false, draft: '' })

// Notes side panel — global list of notes across all sheets, click-to-jump.
// `rev` is bumped whenever a note is saved/deleted so the computed list
// re-runs (the comments engine is plain state, not reactive).
const notesPanel = reactive({ open: false, rev: 0 })

// ── Dropdown (validation) UI state ────────────────────────────────────────────
const dropdownPanel    = reactive({ open: false, id: '', options: [], rule: null, value: '', x: 0, y: 0, w: 120 })
const vdListEl         = ref(null)
const validationDialog = reactive({
  open: false,
  type:     'list',      // 'list' | 'number' | 'text_length'
  operator: 'between',   // 'between' | 'not_between' | 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq'
  val1:     '',
  val2:     '',
  listItems: [],         // [{ label, color }] — color '' means auto (palette by position)
  message:  '',
  severity: 'reject',   // 'reject' blocks the edit; 'warn' allows it but flags the cell
})

// ── Conditional format dialog state ───────────────────────────────────────────
const cfDialog = reactive({
  open: false, editId: null,
  range: { r0: 0, c0: 0, r1: 0, c1: 0 },
  // 'classic' = one-off condition (the original feature).
  // 'color-scale' / 'data-bar' / 'icon-set' = range-scoped scales.
  kind: 'classic',
  condType: 'gt', condValue: '', condValue2: '',
  fmtColor: '', fmtBg: '',
  // Scale-rule state (read only when `kind` is non-classic).
  scaleVariant: '2color',
  scaleMin: '#FFFFFF',
  scaleMid: '#FFEB3B',
  scaleMax: '#0E7490',
  barColor: '#0E7490',
  iconSet:  'arrows3',
})



const cellHistory = reactive({
  open: false, cell: '', loading: false, error: '', entries: [],
})

const borderColor       = ref('#000000')
const borderStyle       = ref('thin')
const freezeRows        = ref(0)
const freezeCols        = ref(0)
const justSaved         = ref(false)

// Short keys keep the select narrow; the full CSS stack lives in FONT_FAMILY_STACK
// so the persisted format value is still a complete font-family string.
const FONT_FAMILY_OPTIONS = [
  { label: 'Inter',  value: 'inter' },
  { label: 'Serif',  value: 'serif' },
  { label: 'Mono',   value: 'mono' },
  { label: 'System', value: 'system' },
]
const FONT_FAMILY_STACK = {
  inter:  'InterVar, Inter, ui-sans-serif, system-ui, sans-serif',
  serif:  'ui-serif, Georgia, "Times New Roman", serif',
  mono:   'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  system: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
}
// `activeFontFamilyKey` is defined further down — after the useToolbar() call
// that creates `activeFormat`. See "Composables" block.

// Flat list driving the dropdown — groups give the menu its sectioned layout.
// Each entry is a stored format string; clicking applies it as-is.
const NUMBER_FORMAT_GROUPS = [
  { group: 'General', options: [
    { label: 'General',         value: ''            },
    { label: 'Plain text',      value: 'text'        },
  ]},
  { group: 'Number', options: [
    { label: 'Decimal',         value: 'number'      },
    { label: 'Decimal — Indian (1,23,456)', value: 'number:in' },
    { label: 'Percent',         value: 'percentage'  },
  ]},
  { group: 'Currency', options: [
    { label: 'USD ($)',         value: 'currency:USD:2' },
    { label: 'EUR (€)',         value: 'currency:EUR:2' },
    { label: 'GBP (£)',         value: 'currency:GBP:2' },
    { label: 'INR (₹)',         value: 'currency:INR:2' },
    { label: 'JPY (¥)',         value: 'currency:JPY:0' },
  ]},
  { group: 'Date', options: [
    { label: 'Auto (locale)',           value: 'date'         },
    { label: 'DD/MM/YYYY',              value: 'date:dmy'     },
    { label: 'MM/DD/YYYY',              value: 'date:mdy'     },
    { label: 'YYYY-MM-DD',              value: 'date:ymd'     },
    { label: '15 Jan 2025',             value: 'date:long'    },
    { label: 'Mon, 15 Jan 2025',        value: 'date:full'    },
  ]},
  { group: 'Time', options: [
    { label: '15:30',           value: 'time:hm'     },
    { label: '15:30:45',        value: 'time:hms'    },
    { label: '3:30 PM',         value: 'time:hm12'   },
    { label: '3:30:45 PM',      value: 'time:hms12'  },
  ]},
  { group: 'Date + Time', options: [
    { label: '15/01/2025, 3:30 PM',     value: 'datetime:dmy_hm12'  },
    { label: '15 Jan 2025, 3:30 PM',    value: 'datetime:long_hm12' },
    { label: '2025-01-15, 15:30:00',    value: 'datetime:ymd_hms'   },
  ]},
]

// Quick-pick currencies surfaced via the $ button. Click cycles to that
// currency; clicking the active one toggles currency back off.
const CURRENCY_QUICK_PICKS = [
  { label: 'USD ($)', code: 'USD', symbol: '$' },
  { label: 'EUR (€)', code: 'EUR', symbol: '€' },
  { label: 'GBP (£)', code: 'GBP', symbol: '£' },
  { label: 'INR (₹)', code: 'INR', symbol: '₹' },
  { label: 'JPY (¥)', code: 'JPY', symbol: '¥' },
]

const BORDER_STYLE_OPTIONS = [
  { label: 'Thin',   value: 'thin' },
  { label: 'Medium', value: 'medium' },
  { label: 'Thick',  value: 'thick' },
]

// Custom decimals-with-arrow glyphs for the precision toolbar buttons. Not in
// lucide, so passed as component props through Button's icon API instead of as
// "lucide-…" strings. stroke-width 1.5 keeps the small inner shapes legible at
// 16 px (Button sm icon size). currentColor + stroke → inherits text-ink-gray
// in light + dark mode, same as the neighbouring lucide icons.
function _decimalsIcon(children) {
  return {
    render: () => h('svg', {
      xmlns: 'http://www.w3.org/2000/svg',
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 1.5,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
    }, children),
  }
}
const DecreaseDecimalIcon = _decimalsIcon([
  h('path', { d: 'm13 21-3-3 3-3' }),
  h('path', { d: 'M20 18H10' }),
  h('path', { d: 'M3 11h.01' }),
  h('rect', { x: 6, y: 3, width: 5, height: 8, rx: 2.5 }),
])
const IncreaseDecimalIcon = _decimalsIcon([
  h('path', { d: 'M10 18h10' }),
  h('path', { d: 'm17 21 3-3-3-3' }),
  h('path', { d: 'M3 11h.01' }),
  h('rect', { x: 15, y: 3, width: 5, height: 8, rx: 2.5 }),
  h('rect', { x: 6,  y: 3, width: 5, height: 8, rx: 2.5 }),
])

const FILTER_OPERATOR_OPTIONS = [
  { label: 'Contains',     value: 'contains' },
  { label: 'Equals',       value: 'equals' },
  { label: 'Greater than', value: 'gt' },
  { label: 'Less than',    value: 'lt' },
  { label: 'Is empty',     value: 'empty' },
  { label: 'Is not empty', value: 'notempty' },
]

const fileDropdownOptions = computed(() => [
  { group: 'Export', options: [
    { label: 'Export as CSV',  icon: 'lucide-download', onClick: () => exportCSV() },
    { label: 'Export as XLSX', icon: 'lucide-download', onClick: () => exportXLSX() },
    { label: 'Export as PDF',  icon: 'lucide-printer',  onClick: () => exportPDF() },
  ]},
  // Import writes cells — hide it for viewers (export/read stays available).
  ...(readOnly.value ? [] : [{ group: 'Import', options: [
    { label: 'Import CSV',  icon: 'lucide-upload', onClick: () => csvInputRef.value?.click() },
    { label: 'Import XLSX', icon: 'lucide-upload', onClick: () => xlsxInputRef.value?.click() },
  ]}]),
  // Only shown to admins — gated server-side via the boot flag so non-admins
  // never see a settings entry they can't use.
  ...(window.frappe?.boot?.ai_assist_can_configure
    ? [{ group: 'AI', options: [
        { label: 'AI settings', icon: 'lucide-cpu', onClick: () => { aiSettingsOpen.value = true } },
      ]}]
    : []),
])

// ── AI Assist ─────────────────────────────────────────────────────────────────
//
// One primitive: select → ask in plain words → see it applied → Keep or Undo.
// The backend returns a validated action plan; the model emits formulas, the
// engine computes. Applying goes through the same pushOp + _queueOp path that
// fill/paste use, so a single Undo reverts the whole batch and the change
// joins the existing op-log / autosave / collab pipeline.

const aiEnabled  = ref(!!window.frappe?.boot?.ai_assist_enabled)
const askOpen    = ref(false)
const askBusy    = ref(false)
const askError   = ref('')
const askAnswer  = ref('')
const aiPending  = ref(null)              // null | { count }
const askSelectionLabel = ref('')

// After saving AI settings, refresh the boot flag + reactive ref in-place so
// the "Ask" entry point appears/disappears without a full reload.
function onAiSettingsSaved(s) {
  // The keyless "mock"/"demo" model counts as configured too.
  const isMock = ['mock', 'demo'].includes(String(s?.model || '').trim().toLowerCase())
  const on = !!(s?.enabled && (s?.keyIsSet || isMock))
  if (window.frappe?.boot) window.frappe.boot.ai_assist_enabled = on
  aiEnabled.value = on
}

function openAskBar() {
  askError.value = ''
  askAnswer.value = ''
  aiPending.value = null
  askSelectionLabel.value = grid?.getActiveCell?.() || ''
  askOpen.value = true
}

function closeAskBar() {
  // Closing with a pending change is an implicit Keep — it's already applied
  // and queued.
  askOpen.value = false
  askError.value = ''
  askAnswer.value = ''
  aiPending.value = null
}

async function onAskSubmit(promptText) {
  askError.value = ''
  askAnswer.value = ''
  aiPending.value = null
  askBusy.value = true
  try {
    const sel = grid?.getSelection?.() || { r0: 0, c0: 0, r1: 0, c1: 0 }
    const selection = JSON.stringify({
      sheet:  sheet.getCurrentSheet(),
      r0: sel.r0, c0: sel.c0, r1: sel.r1, c1: sel.c1,
      active: grid?.getActiveCell?.() || '',
    })
    const res = await call('suite.sheets.api.ai_assist', {
      name: props.id, prompt: promptText, selection,
    })
    const actions = Array.isArray(res?.actions) ? res.actions : []
    const answers = actions.filter(a => a.type === 'answer')
    if (answers.length) askAnswer.value = answers.map(a => a.text).join('\n\n')
    const applied = _applyAiActions(actions)
    if (applied > 0) aiPending.value = { count: applied }
    else if (!answers.length) askAnswer.value = 'No changes suggested for that.'
  } catch (e) {
    askError.value = (e && e.message) ? String(e.message) : 'Something went wrong'
  } finally {
    askBusy.value = false
  }
}

// Apply setCell actions as ONE undoable op (mirrors the fill/paste path).
// Returns the number of cells written.
function _applyAiActions(actions) {
  const sn = sheet.getCurrentSheet()
  let setCells = actions.filter(a => a.type === 'setCell')
  // Drop writes that land on protected cells (rest still apply).
  const allowed = setCells.filter(a => !_cellSilentlyProtected(a.cell, sn))
  if (allowed.length !== setCells.length) _flashProtected(sn)
  setCells = allowed
  if (!setCells.length) return 0

  const before = {}
  const after  = {}
  for (const a of setCells) before[a.cell] = sheet.getCell(a.cell, sn) ?? ''
  for (const a of setCells) {
    sheet.setCell(a.cell, a.formula, sn)
    after[a.cell] = a.formula
  }
  const refs = setCells.map(a => a.cell)

  // Undo (op-based, like fill) + server sync (op-log on next save).
  history.pushOp({ opType: 'ai_assist', subSheet: sn, cellRefs: refs, before, after })
  _queueOp({
    opType: 'ai_assist', subSheet: sn, cellRefs: refs, before, after,
    summary: `AI: ${refs.length} cell${refs.length === 1 ? '' : 's'}`,
  })

  grid?.render()
  refreshActiveFormat()
  syncFlags()
  isDirty.value = true
  return refs.length
}

function onAskKeep() {
  // Already applied + queued; just dismiss and close.
  closeAskBar()
}

function onAskUndo() {
  // Reverts the whole batch in one step (single op). Drop the still-queued
  // op so a stale ai_assist entry isn't persisted on the next save.
  undo()
  _popLastOp('ai_assist')
  aiPending.value = null
}

// Remove the most recently queued op of a given type (used when an AI change
// is undone before it has been flushed to the server).
function _popLastOp(opType) {
  for (let i = _opQueue.length - 1; i >= 0; i--) {
    if (_opQueue[i].opType === opType) { _opQueue.splice(i, 1); return }
  }
}

const hAlignIcon = computed(() => {
  if (activeFormat.value?.align === 'center') return 'lucide-align-center'
  if (activeFormat.value?.align === 'right')  return 'lucide-align-right'
  return 'lucide-align-left'
})



// The logged-in user for the top-right avatar, from the shared suite session
// store (cookie-backed, refreshed by userResource — see @/boot/session). The
// old window.frappe.session reads only worked on the standalone www page; the
// suite shell never sets window.frappe, so the avatar collapsed to "U".
const { user: userEmail, fullName: userFullName, imageURL: userImage } = useCurrentUser()
const userInitial = computed(() => userInitials(userFullName.value, userEmail.value))

// Collaboration — presence + sharing
const shareOpen   = ref(false)
const shareCount  = ref(0)   // explicit share count (excluding owner); updated by ShareDialog
const aiSettingsOpen = ref(false)
const { exportCSV, exportXLSX, exportPDF, importCSV, importXLSX } = useExportImport({
  getSheet:        () => sheet,
  getCurrentTitle: () => currentTitle.value,
  getGrid:         () => grid,
  getFormats:      () => formats,
  getMerge:        () => merge,
  queueOp:         _queueOp,
  repopulateGrid:  _repopulateGrid,
  // Defined later by useSheetTabs — lazy-wrapped so they resolve at call time.
  syncNames:       () => syncNames(),
  switchSheet:     (n) => switchSheet(n),
  syncFlags,
  isDirty,
})

// Filter panel state.
//   - mode: 'values' (Google-Sheets-style checklist) or 'condition' (operator
//     + value). Default to 'values' since that's the more discoverable path.
//   - valueSet: which distinct displayed values are currently checked. Stored
//     as a real Set for O(1) toggles; serialised to an array when persisted
//     via sortFilter.setFilter.
//   - allValues: distinct displayed values in the column's data range, cached
//     while the panel is open so we don't recompute on every keystroke.
const filterPanel = reactive({
  open: false, col: 0,
  mode: 'values',
  operator: 'contains', value: '',
  valueSet: new Set(),
  valueSearch: '',
  allValues: [],
})

const filteredFilterValues = computed(() => {
  const q = filterPanel.valueSearch.trim().toLowerCase()
  if (!q) return filterPanel.allValues
  return filterPanel.allValues.filter(v => String(v).toLowerCase().includes(q))
})

// True while the value search box narrows the list — Select all / Clear then
// act on the shown subset, so their labels change to say so.
const valueSearchActive = computed(() => filterPanel.valueSearch.trim() !== '')

function toggleFilterValue(v) {
  if (filterPanel.valueSet.has(v)) filterPanel.valueSet.delete(v)
  else                             filterPanel.valueSet.add(v)
}

function selectAllFilterValues() {
  // Only the values currently visible under the search filter — matches
  // Google Sheets behaviour where "Select all" respects the search box.
  for (const v of filteredFilterValues.value) filterPanel.valueSet.add(v)
}

function clearAllFilterValues() {
  for (const v of filteredFilterValues.value) filterPanel.valueSet.delete(v)
}

// Auto-close the filter popover on any click outside its body or the
// chevron that opened it. Mirrors how Google Sheets handles this — users
// shouldn't have to remember to hit "Close" before editing a cell.
function _filterPanelOutsideClick(e) {
  const t = e.target
  if (!t || !(t instanceof Element)) return
  if (t.closest('.sn-filter-panel'))         return  // click inside the popover itself
  if (t.closest('.sn-filter-btn'))           return  // click on a chevron toggles its own panel
  // Frappe UI's Select/Combobox/Dropdown render their dropdown into a portal
  // (SelectPortal → body), so the listbox options live OUTSIDE the panel's
  // DOM subtree. Without this exemption, clicking "Equals" / "Greater than"
  // on the condition-mode operator picker fired the outside-click handler
  // and slammed the whole panel shut. The portaled content is tagged with
  // data-slot="content" on the wrapper, so an ancestor match catches every
  // descendant click (items, scroll viewport, etc.).
  if (t.closest('[data-slot="content"]'))    return
  filterPanel.open = false
}
watch(() => filterPanel.open, (open) => {
  // `mousedown` (not click) so the close fires before any other component
  // gets the focus/selection event — keeps the panel from leaving stale
  // state behind when the user just clicks elsewhere in the sheet.
  if (open) document.addEventListener('mousedown', _filterPanelOutsideClick, true)
  else      document.removeEventListener('mousedown', _filterPanelOutsideClick, true)
})

let grid = null
let ro   = null

function syncFlags() { canUndo.value = history.canUndo(); canRedo.value = history.canRedo() }

function selectionIds() {
  if (!grid) return [activeCell.value]
  const { r0, c0, r1, c1 } = grid.getSelection()
  const ids = []
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++)
      ids.push(colLabel(c) + (r + 1))
  return ids
}

// ── Selection stats ───────────────────────────────────────────────────────────

// Count / Sum / Avg in the status bar. Called from onSelect on every
// selection change (arrow nav, click, drag-extend, Enter advancing), so
// it has to be cheap.
//
// Old impl walked Object.entries(sheet.getRawData()) — every cell in the
// whole sheet — and parseCellId-tested each one against the rect. On a
// 5k-row sheet that was ~25k cells × regex match per call, fires twice
// per keyup (once from onSelect, once from the keyup listener), so each
// arrow press paid ~50k cell scans. The perf trace pinned this at 886 ms
// in onSelect.
//
// New impl iterates the *selection rect* directly via sheet.getCell. For
// a 5×5 selection that's 25 reads instead of 25k. Worst case is Ctrl+A
// (whole sheet) which is the same as before. RAF-coalesced so a drag-
// extend that fires onSelect 1000× still computes stats once per frame.
// Stats run ASYNC and chunked. Selecting to the end of a big sheet
// (Cmd+Shift+Down → ~2M cells) used to compute Count/Sum/Avg synchronously in
// one RAF, freezing the interaction for ~6s. The status bar is a non-critical
// readout, so we yield every CHUNK_CELLS and bail the instant a newer
// selection supersedes us — the selection paints immediately and the numbers
// fill in a moment later.
const _STATS_CHUNK_CELLS = 50000
let _statsRAF = null
let _statsToken = 0
function computeSelectionStats() {
  _statsToken++
  if (_statsRAF) cancelAnimationFrame(_statsRAF)
  const token = _statsToken
  _statsRAF = requestAnimationFrame(() => {
    _statsRAF = null
    _computeSelectionStatsAsync(token)
  })
}
async function _computeSelectionStatsAsync(token) {
  if (!grid) return
  const { r0, c0, r1, c1 } = grid.getSelection()
  if ((r1 - r0 + 1) * (c1 - c0 + 1) <= 1) { selectionStats.value = null; return }
  const sn = sheet.getCurrentSheet()
  // Precompute column labels once instead of rebuilding each cell id's prefix
  // 2M times (colLabel walks characters per call).
  const labels = []
  for (let c = c0; c <= c1; c++) labels.push(colLabel(c))
  const rowWidth = c1 - c0 + 1
  let count = 0, numCount = 0, sum = 0, since = 0
  for (let r = r0; r <= r1; r++) {
    const rowSuffix = r + 1
    for (let c = c0; c <= c1; c++) {
      const id = labels[c - c0] + rowSuffix
      const raw = sheet.getCell(id, sn)
      if (raw === '' || raw == null) continue
      count++
      // Aggregate the computed value, not the raw text: a formula cell holds
      // "=SUM(...)" in getCell but evaluates to a number via getCellValue, so
      // parseFloat on the raw string would drop it from Sum/Avg (but not Count).
      const val = sheet.getCellValue(id, sn)
      const n = typeof val === 'number' ? val : parseFloat(val)
      if (!isNaN(n)) { numCount++; sum += n }
    }
    since += rowWidth
    if (since >= _STATS_CHUNK_CELLS) {
      since = 0
      await new Promise(res => setTimeout(res, 0))
      if (token !== _statsToken) return   // a newer selection took over
    }
  }
  if (token !== _statsToken) return
  selectionStats.value = (count === 0 && numCount === 0) ? null : {
    count,
    sum:  numCount > 0 ? sum : null,
    avg:  numCount > 0 ? sum / numCount : null,
  }
}

function formatStat(n) {
  return Number.isInteger(n) ? n.toLocaleString() : parseFloat(n.toFixed(4)).toLocaleString()
}


// ── Number format helpers ─────────────────────────────────────────────────────
// Grammar + renderer live in utils/format-number.js so they can be unit-tested
// in isolation. The toolbar wiring below is the only Vue-specific bit.

// Bump decimal precision for the selection. Treats 'General' as 'number:1' on
// first +, no-op on -. Numeric types pick a sensible default if no decimals
// were previously set.
function adjustDecimals(delta) {
  const ids = selectionIds()
  const sh = sheet.getCurrentSheet()
  _recordFormatOp(ids, sh, () => {
  for (const id of ids) {
    const cur = formats.get(id, sh).numberFormat || ''
    let { type, variant, decimals } = parseNumberFmt(cur)
    if (!type) {
      if (delta < 0) continue
      type = 'number'
      decimals = 0
    }
    const defaultDec = type === 'currency' ? 2 : type === 'percentage' ? 2 : 2
    if (decimals == null) decimals = defaultDec
    decimals = Math.max(0, Math.min(20, decimals + delta))
    const next = buildNumberFmt(type, variant, decimals)
    formats.applyToRange([id], { numberFormat: next }, sh)
    const raw = sheet.getDisplayValue(id)
    grid?.setCell(id, applyNumberFmt(raw, next))
  }
  })
  _syncNumberFormat(activeCell.value)
  syncFlags()
  isDirty.value = true
  recordAction?.('adjustDecimals', [delta])
}

// ── Composables ───────────────────────────────────────────────────────────────

const { activeFormat, refreshActiveFormat, toggleFmt, setAlign, setValign, setColor, clearFormatting, getLastAction, recordAction } =
  useToolbar({ sheet, formats, getGrid: () => grid, history, selectionIds, getScope: _selectionScope, syncFlags, markDirty: () => { isDirty.value = true } })

// Selection + grid bounds, so full-column / full-row / whole-sheet selections
// format at the column/row level (one entry) instead of per cell. Null when
// the grid isn't mounted yet → callers fall back to per-cell.
function _selectionScope() {
  if (!grid) return null
  return { rect: grid.getSelection(), totalRows: grid.getTotalRows(), totalCols: grid.getTotalCols() }
}

// Toolbar dropdown configs that don't depend on pivot composable.
function toggleSortFilter() { showSortFilter.value = !showSortFilter.value }
const alignDropdownOptions  = buildAlignOptions({ setAlign, setValign })
const borderDropdownOptions = buildBorderOptions({ applyBorder })

// Maps the current cell's font-family string back to a short key so the
// toolbar select shows e.g. "Inter" instead of the full CSS stack.
const activeFontFamilyKey = computed(() => {
  const f = activeFormat.value?.fontFamily
  if (!f) return 'inter'
  for (const [k, v] of Object.entries(FONT_FAMILY_STACK)) if (v === f) return k
  return 'inter'
})

const activeFontFamilyLabel = computed(() =>
  FONT_FAMILY_OPTIONS.find(o => o.value === activeFontFamilyKey.value)?.label || 'Inter'
)

const fontFamilyDropdownOptions = computed(() =>
  FONT_FAMILY_OPTIONS.map(o => ({
    label: o.label,
    onClick: () => setFontFamily(o.value),
  }))
)

// Maps the stored format string → human label shown on the dropdown trigger.
// Falls back to the type when the exact format isn't a named preset (e.g.
// the user bumped decimals on a currency format).
const _FORMAT_LABELS = (() => {
  const m = new Map()
  for (const g of NUMBER_FORMAT_GROUPS) for (const it of g.options) m.set(it.value, it.label)
  return m
})()

// Custom number-format dialog. `pattern` is a raw Excel-style code; it's
// stored as `custom:<pattern>` so the display path routes it to applyCustomFmt.
const customFormatDialog = reactive({ open: false, pattern: '' })

function openCustomFormatDialog() {
  const cur = parseNumberFmt(activeNumberFormat.value)
  customFormatDialog.pattern = cur.type === 'custom' ? cur.pattern : '#,##0.00'
  customFormatDialog.open = true
}

// Live preview against a representative value so the user sees the effect
// before applying. Falls back to empty on a pattern that throws.
const customFormatPreview = computed(() => {
  const p = customFormatDialog.pattern.trim()
  if (!p) return ''
  try { return applyNumberFmt(1234.567, 'custom:' + p) } catch { return '' }
})

function confirmCustomFormat() {
  const p = customFormatDialog.pattern.trim()
  if (p) onNumberFormatChange('custom:' + p)
  customFormatDialog.open = false
}

const numberFormatLabel = computed(() => {
  const cur = activeNumberFormat.value
  if (_FORMAT_LABELS.has(cur)) return _FORMAT_LABELS.get(cur)
  const { type, variant } = parseNumberFmt(cur)
  if (!type) return 'General'
  // Synthesise a label for variants that don't have a preset (e.g. user
  // adjusted decimals on a known type+variant combo).
  if (type === 'currency') return `Currency · ${variant || 'USD'}`
  if (type === 'date')     return variant ? `Date · ${variant}` : 'Date'
  if (type === 'time')     return variant ? `Time · ${variant}` : 'Time'
  if (type === 'datetime') return 'Date + Time'
  return type[0].toUpperCase() + type.slice(1)
})

const numberFormatDropdownOptions = computed(() => [
  ...NUMBER_FORMAT_GROUPS.map(g => ({
    group: g.group,
    options: g.options.map(it => ({
      label: it.label,
      onClick: () => onNumberFormatChange(activeNumberFormat.value === it.value ? '' : it.value),
    })),
  })),
  { group: 'Custom', options: [
    { label: 'Custom format…', onClick: () => openCustomFormatDialog() },
  ]},
])

// Active currency code (for the $-button symbol). Defaults to $ when the cell
// isn't a currency at all, so the button always says *something* clickable.
const activeCurrencySymbol = computed(() => {
  const { type, variant } = parseNumberFmt(activeNumberFormat.value)
  if (type !== 'currency') return '$'
  const hit = CURRENCY_QUICK_PICKS.find(c => c.code === (variant || 'USD'))
  return hit ? hit.symbol : '$'
})

const currencyDropdownOptions = computed(() =>
  CURRENCY_QUICK_PICKS.map(c => {
    const fmt = `currency:${c.code}:${c.code === 'JPY' ? 0 : 2}`
    return {
      label: c.label,
      onClick: () => onNumberFormatChange(activeNumberFormat.value === fmt ? '' : fmt),
    }
  })
)

function repeatLast() {
  const last = getLastAction()
  if (!last) return
  const handlers = { toggleFmt, setAlign, setValign, setColor, clearFormatting, adjustDecimals, adjustFontSize, setFontSize, setFontFamily, toggleWrap }
  handlers[last.kind]?.(...last.args)
}

// Wrap text needs a row-height bump to actually be visible — toggleFmt alone
// flips the format flag but the renderer's wrapped text gets clipped at the
// Writes `textWrap` (overflow | clip | wrap) for the selection. Auto-fits
// every row to fit wrapped content when the user opts into wrap mode; the
// other modes leave row heights alone (user may have grown rows manually).
function setTextWrap(mode) {
  formats.applyToRange(selectionIds(), { textWrap: mode }, sheet.getCurrentSheet())
  refreshActiveFormat()
  isDirty.value = true
  if (mode === 'wrap' && grid) {
    const { r0, r1 } = grid.getSelection()
    for (let r = r0; r <= r1; r++) grid.autoFitRow(r)
  }
  recordAction?.('setTextWrap', [mode])
}

// Kept for the repeat-last shortcut handler (which dispatches by action
// name); rebound to setTextWrap('wrap') / 'overflow' toggle.
function toggleWrap() {
  setTextWrap(activeTextWrap.value === 'wrap' ? 'overflow' : 'wrap')
}

const activeTextWrap = computed(() => getTextWrap(activeFormat.value))

const TEXT_WRAP_ICON = { overflow: 'lucide-corner-down-right', clip: 'lucide-minimize', wrap: 'lucide-corner-down-left' }
const textWrapIcon   = computed(() => TEXT_WRAP_ICON[activeTextWrap.value] || 'lucide-corner-down-left')

const textWrapDropdownOptions = computed(() => [
  { label: 'Overflow', icon: TEXT_WRAP_ICON.overflow, onClick: () => setTextWrap('overflow') },
  { label: 'Clip',     icon: TEXT_WRAP_ICON.clip,     onClick: () => setTextWrap('clip')     },
  { label: 'Wrap',     icon: TEXT_WRAP_ICON.wrap,     onClick: () => setTextWrap('wrap')     },
])

// View state is now per-sheet (kept in useSheetTabs._viewBySheet) so freeze /
// hidden rows / column widths / etc. follow each tab independently. usePersistence
// is constructed before useSheetTabs, so the get/apply callbacks late-bind via
// `_sheetTabs` once that hook returns its API. The `grid?.viewSnapshot/Restore`
// fallbacks only cover the impossible window where someone saves before
// useSheetTabs has finished initializing.
let _sheetTabs = null
const { isSaving, saveError, canWrite, sheetOwner, loadError, loadSheet, autoCreate, saveExisting, retrySave } =
  usePersistence({
    sheet, formats, merge, comments, validation, protection, condFormat, sortFilter, slicers, pivot,
    charts, namedRanges,
    getViewState:   () => _sheetTabs?.viewSnapshot?.() ?? grid?.viewSnapshot?.(),
    applyViewState: (s) => {
      if (_sheetTabs?.viewRestore) _sheetTabs.viewRestore(s)
      else                         grid?.viewRestore?.(s)
    },
    currentTitle, emit,
  })

// View-only mode: the loaded sheet is shared with the current user at read
// (not write) permission. Everything that mutates the doc keys off this — the
// grid edit gate, the toolbar/formula-bar disable, the context menu, and the
// autosave path all no-op so a viewer is never misled into editing a doc they
// can't persist (and never triggers the server's PermissionError on save).
const readOnly = computed(() => !canWrite.value)

_sheetTabs = useSheetTabs({ sheet, formats, extras: [merge, comments, validation, protection, condFormat, sortFilter, slicers], getGrid: () => grid, activeCell, formulaValue, refreshActiveFormat, onSwitch: () => {
    filterPanel.open = false     // close any open filter popover so it doesn't carry stale state
    _repopulateGrid()
    grid?.setMarchingAnts(null); clipboard.clear(); clipboardHas.value = false
    _applyHiddenRows()           // refresh filter-driven row hides for the new sheet
    // Diff overlay is keyed by sub-sheet name — re-point at the new sheet
    // so the highlight follows the user across tabs in preview mode.
    if (vhActive.value) grid?.setActiveDiffSheet?.(sheet.getCurrentSheet())
    // Re-mirror freeze / hidden refs into the Vue state so the context-menu
    // predicates and toolbar reflect the new sheet's restored view.
    _syncViewMirrors()
  } })

const {
  sheetNames, currentSheet, switchSheet,
  addSheet:       _addSheet,
  renameSheet:    _renameSheet,
  duplicateSheet: _duplicateSheet,
  deleteSheet:    _deleteSheet,
  reorderSheets,
  syncNames,
} = _sheetTabs

// Formula autocomplete — placed here because sheetNames comes from useSheetTabs above.
const { acItems, acIdx, acUp, acVisible, updateAc, commitAc, closeAc } =
  useFormulaAutocomplete({ formulaInputRef, formulaValue, sheetNames })

// Context menu — placed here because contextMenu is passed to usePivotIntegration below.
const { contextMenu, tabMenu, openCanvasContextMenu: onCanvasContextMenu, openTabMenu } =
  useContextMenu({ getGrid: () => grid })

// The right-click menu is entirely mutation actions (insert/delete/freeze/
// paste-special/…), so suppress it for viewers — the native browser menu still
// offers copy. Defined here (after the alias) and wired at listener setup.
function _onCanvasContextMenu(e) {
  if (readOnly.value) return
  onCanvasContextMenu(e)
}

// Same reasoning for the sheet-tab menu: every item (rename/duplicate/protect/
// delete) mutates, so a viewer has nothing to do there. Suppress it entirely —
// `.prevent` on the binding still eats the native menu — rather than open an
// empty popover. Rename (dbl-click) and reorder (drag) are gated separately.
function _onTabMenu(e, name) {
  if (readOnly.value) return
  openTabMenu(e, name)
}

// renderVersion is defined here because usePivotIntegration reads it at call time.
const renderVersion = ref(0)

// Pivot integration — placed here because switchSheet/syncNames come from useSheetTabs above.
const {
  pivotDialogOpen, pivotInitialRange, pivotEditId, pivotEditConfig, pivotVersion, pivotBuilding,
  activePivotConfig, pivotFabStyle, pivotHighlightStyle, pivotBannerMenuOptions,
  isPivotSheet, openPivotDialog, onPivotEdit, onPivotRefresh, onPivotDelete, onPivotConfirm,
  recomputePivotsForSheet, drillDownAt, getPivotAt, createPastedPivot,
} = usePivotIntegration({
  pivot, sheet, formats, currentSheet, activeCell, renderVersion,
  getGrid: () => grid,
  contextMenu, switchSheet, syncNames,
  history, isDirty, repopulateGrid: _repopulateGrid,
})

// Chart integration — engine + dialog wiring. Charts float above the canvas
// (ChartOverlay) and re-derive their source matrices reactively from the
// sheet engine, so any cell edit propagates without explicit refresh calls.
const {
  chartDialogOpen, chartInitialRange, chartEditId, chartEditConfig,
  charts: chartList, selectedChartId, chartVersion, chartDataVersion,
  openInsert: openChartDialog, openEdit: openChartEdit,
  onChartConfirm, onChartDelete, onChartMove, onChartResize, onChartRefresh,
  selectChart, getMatrix: getChartMatrix,
} = useChartIntegration({
  chart: charts, sheet, currentSheet,
  contextMenu, history, isDirty,
  getGrid: () => grid,
})

const moreToolbarOptions = buildMoreToolbarOptions({
  toggleFmt, toggleWrap, toggleFormatPainter, clearFormatting,
  adjustDecimals, openCfDialog, openHyperlinkDialog, toggleMerge,
  toggleSortFilter, applyBorder, zoomBy, resetZoom, openPivotDialog,
  openChartDialog, openNamedRangesDialog, runSmartFill,
})

// Collaboration — placed here because currentSheet comes from useSheetTabs above.
const { presentUsers, remoteCursors, broadcastCellChange, broadcastBatchChange, broadcastCursor, drainLocalTouches } =
  useCollaboration({
    sheetId:        computed(() => props.id),
    currentSheet,
    getSheet:       () => sheet,
    repopulateGrid: _repopulateGrid,
  })
// Wire the binding's per-segment touch-tracking into the history we declared
// up top — undo() will now revert only this client's writes from the undone
// segment, leaving any remote-applied cells alone.
_collabDrainLocalTouches = drainLocalTouches

// Version history — placed after usePersistence (loadSheet) and useSheetTabs (switchSheet/syncNames).
const {
  vhOpen, vhVersions, vhLoading, vhError, vhActive, vhRestoring, vhDiff, vhStepIdx,
  openVersionHistory, closeVersionHistory,
  previewVersion, exitPreview, stepPreviewDiff,
  restorePreview, nameCurrentPreview, nameVersionInline,
  makeACopyInline, restoreVersionInline,
} = useVersionHistory({
  sheetId:        computed(() => props.id),
  getSheet:       () => sheet,
  getFormats:     () => formats,
  getMerge:       () => merge,
  getComments:    () => comments,
  getValidation:  () => validation,
  getProtection:  () => protection,
  getCondFormat:  () => condFormat,
  getSortFilter:  () => sortFilter,
  getSlicers:     () => slicers,
  getGrid:        () => grid,
  currentTitle,
  switchSheet,
  syncNames,
  repopulateGrid: _repopulateGrid,
  syncViewMirrors: _syncViewMirrors,
  loadSheet,
  history,
  activeCell,
})

// Split text — placed after currentSheet from useSheetTabs.
const {
  splitText,
  doSplitTextToColumns,
  onSplitChoose,
  onSplitApply,
  onSplitCancel,
  revertSplitPreview: _revertSplitPreview,
  closeSplit:         _closeSplit,
} = useSplitText({
  getSheet:       () => sheet,
  getGrid:        () => grid,
  getGridWrap:    () => gridWrapRef.value,
  contextMenu,
  currentSheet,
  queueOp:        _queueOp,
  markEdited,
  repopulateGrid: _repopulateGrid,
  syncFlags,
  captureRange:   _captureRange,
  diffRefs:       _diffRefs,
  blockProtected: (rect, sn) => _rectBlocked(rect, sn),
})

// `showSortFilter` is the existing template/handler API; with ranged filters
// it's now derived from "does this sheet have a filter range?".  Writing true
// creates a filter on the current selection; writing false removes it.
const showSortFilter = computed({
  get() {
    renderVersion.value
    return sortFilter.hasFilter(currentSheet.value)
  },
  set(v) { v ? _createFilterOnSelection() : _removeFilter() },
})

// Adding a sheet used to push a full-workbook snapshot (history.push deep-clones
// every cell of every sheet — ~2s on a large workbook). The new sheet is empty,
// so undo/redo only needs its name: a cheap structural op instead of a snapshot.
function addSheet() {
  const name = _addSheet()
  history.pushOp({ opType: 'sheet_add', subSheet: name, name })
  isDirty.value = true
}

// ── Sheet-tab click — cross-sheet picker support ──────────────────────────────
// When the user is mid-edit in the formula bar (`=…` content + bar has focus),
// clicking another tab should keep the edit alive instead of trashing it.
// The trick is two-fold: prevent the default mousedown so focus stays on the
// input, and call switchSheet with preserveEdit so activeCell + formulaValue
// don't get clobbered by the switch.
function _isEditingFormulaInBar() {
  return document.activeElement === formulaInputRef.value
    && typeof formulaValue.value === 'string'
    && formulaValue.value.startsWith('=')
}

function _isEditingFormulaInCell() {
  return grid?.isEditingFormula?.() ?? false
}

function _isEditingFormula() {
  return _isEditingFormulaInBar() || _isEditingFormulaInCell()
}

function onTabMousedown(e, _name) {
  // Default mousedown on the tab button focuses it, which would blur the
  // formula-bar input (or the in-cell overlay) before our click handler can
  // snapshot the edit. Suppress only when an active formula edit needs the
  // focused element to keep focus.
  if (_isEditingFormula()) e.preventDefault()
}

function onTabClick(name) {
  if (_isEditingFormula()) {
    if (!editingHomeSheet.value) {
      editingHomeSheet.value = sheet.getCurrentSheet()
      editingHomeCell.value  = activeCell.value
    }
    switchSheet(name, { preserveEdit: true })
    // Re-focus whichever input was being edited — some Buttons steal focus
    // on click despite mousedown preventDefault.
    nextTick(() => {
      if (_isEditingFormulaInCell()) return  // overlay handles its own focus
      formulaInputRef.value?.focus()
    })
  } else {
    switchSheet(name)
  }
}

// ── Sheet-tab drag-to-reorder ─────────────────────────────────────────────────
const tabDragName = ref(null)
const tabDragOver = ref(null)

// Reorder is a mutation. `:draggable="!readOnly"` stops a viewer starting a
// drag, but dragover/drop still fire when *another* element is dragged onto a
// tab — guard the whole lifecycle so the invariant "viewers can't reorder" is
// explicit here, not just an emergent effect of the null tabDragName.
function onTabDragStart(e, name) {
  if (readOnly.value) return
  tabDragName.value = name
  e.dataTransfer.effectAllowed = 'move'
  // Some browsers require setData to allow the drag
  try { e.dataTransfer.setData('text/plain', name) } catch (_) {}
}
function onTabDragOver(e, name) {
  if (readOnly.value) return
  if (!tabDragName.value || tabDragName.value === name) return
  e.dataTransfer.dropEffect = 'move'
  tabDragOver.value = name
}
function onTabDrop(e, target) {
  if (readOnly.value) return
  const src = tabDragName.value
  if (!src || src === target) { tabDragOver.value = null; return }
  const next = sheetNames.value.filter(n => n !== src)
  const idx  = next.indexOf(target)
  next.splice(idx, 0, src)
  reorderSheets(next)
  tabDragOver.value = null
  tabDragName.value = null
  history.push()
  isDirty.value = true
}
function onTabDragEnd() { tabDragName.value = null; tabDragOver.value = null }

// ── Add more rows ─────────────────────────────────────────────────────────────
const addRowsCount = ref(1000)

// The strip is hidden until the viewport reaches the last ~10 rows, then
// surfaces so the user can extend the sheet without scrolling past empty space.
// `renderVersion` ticks on every canvas render, so this reactively updates with
// scroll, resize, freeze, and expandRows.
const showAddRows = computed(() => {
  renderVersion.value
  return grid?.isNearBottom?.(10) ?? false
})

function doAddMoreRows() {
  const n = Math.max(1, Math.min(10000, parseInt(addRowsCount.value, 10) || 1000))
  grid?.expandRows(n)
  history.push()
  isDirty.value = true
}

// ── Filter overlay geometry ───────────────────────────────────────────────────

const filterConfig = computed(() => {
  renderVersion.value          // re-eval when canvas re-renders (e.g. filter apply)
  return sortFilter.getFilterConfig(currentSheet.value)
})

const filterRange = computed(() => {
  renderVersion.value
  return sortFilter.getRange(currentSheet.value)
})

// Chevron buttons appear only on the header row of the active filter range —
// at most one filter per sheet, scoped to its rectangle (Google-Sheets-style).
const visibleFilterCols = computed(() => {
  renderVersion.value
  if (!grid || !filterRange.value) return []
  const { r0, c0, c1 } = filterRange.value
  const rowRect = grid.getRowRect(r0)
  const rects   = grid.getColumnHeaderRects().filter(({ c }) => c >= c0 && c <= c1)
  const BTN = 16
  return rects.map(({ c, x, width }) => ({
    col: c,
    style: {
      left:   (x + width - BTN - 3) + 'px',
      top:    (rowRect.y + (rowRect.height - BTN) / 2) + 'px',
      width:  BTN + 'px',
      height: BTN + 'px',
    },
  }))
})

// Live position for the open filter panel. Recomputed on every canvas render
// (renderVersion) so the panel tracks its column as the grid scrolls, anchored
// to the column's chevron just like visibleFilterCols. Returns display:none when
// the column scrolls out of the visible header range so the panel hides instead
// of floating over unrelated columns; it reappears when scrolled back into view.
const filterPanelStyle = computed(() => {
  renderVersion.value
  if (!filterPanel.open || !grid || !filterRange.value) return { display: 'none' }
  const { r0 } = filterRange.value
  const colRect = grid.getColumnHeaderRects().find(({ c }) => c === filterPanel.col)
  const rowRect = grid.getRowRect(r0)
  if (!colRect || !rowRect) return { display: 'none' }
  const BTN = 16
  const wrapW = gridWrapRef.value?.getBoundingClientRect().width ?? Infinity
  return {
    top:  (rowRect.y + rowRect.height + 2) + 'px',
    left: clampFilterLeft(colRect.x + colRect.width - BTN - 3, wrapW) + 'px',
  }
})

// Outline drawn around the active filter's rectangle so its extent is visible
// (Google-Sheets-style). Mirrors the pivot highlight: bounding box from the
// range's top-left / bottom-right cell rects, clamped to the header strips so
// it never paints over the row-number gutter or column-header row when the
// range is scrolled partly out of view.
const filterHighlightStyle = computed(() => {
  renderVersion.value
  if (!showSortFilter.value || !grid || !filterRange.value) return null
  const { r0, c0, r1, c1 } = filterRange.value
  const tl = grid.getCellRect?.(r0, c0)
  const br = grid.getCellRect?.(r1, c1)
  if (!tl || !br) return null
  const zoom    = grid.getZoom?.() ?? 1
  // `|| Infinity` treats a 0/undefined viewport (before the first layout) as
  // "unclamped" — a 0 would otherwise collapse the overlay to nothing.
  const vp    = grid.getViewportSize?.()
  const viewW = vp?.w || Infinity
  const viewH = vp?.h || Infinity
  return overlayRectStyle(tl, br, {
    headerX: ROW_HEADER_W * zoom,
    headerY: COL_HEADER_H * zoom,
    viewW, viewH,
  })
})

// Per-sub-sheet peer dots — small colored circles next to each tab label
// so you can see at a glance who's looking at which tab without having
// to switch. Caps at 3 dots + "+N" overflow per tab.
const peersBySubSheet = computed(() => {
  const out = new Map()  // name → Array<{user, color, full_name}>
  for (const u of presentUsers.value) {
    if (!u.sub_sheet) continue
    if (!out.has(u.sub_sheet)) out.set(u.sub_sheet, [])
    out.get(u.sub_sheet).push(u)
  }
  return out
})

// Per-user memory of the last-seen remote (row, col, subSheet) so we can
// tell "the peer actually moved" from "the local viewport scrolled". The
// CSS transition on `.sn-remote-cursor--moved` only fires on real motion.
const _lastRemoteRC = new Map()  // user → 'r:c:subSheet'

// Remote cursors for users on the same sheet — re-evaluated when the canvas renders
// (renderVersion) or when remoteCursors updates.
const visibleRemoteCursors = computed(() => {
  renderVersion.value
  if (!grid) return []
  // Prune lastRC entries for peers that left so the Map doesn't grow
  // unbounded as users come and go through a long session.
  for (const user of _lastRemoteRC.keys()) {
    if (!remoteCursors.value.has(user)) _lastRemoteRC.delete(user)
  }
  return [...remoteCursors.value.entries()]
    .filter(([, cursor]) => cursor.subSheet === currentSheet.value)
    .map(([user, cursor]) => {
      // Compute a single rect that covers the whole remote range. We pull
      // the top-left cell rect for x/y and the bottom-right cell rect to
      // sum the trailing width/height — handles non-uniform column widths
      // / row heights correctly.
      const r = cursor.range || { r0: cursor.row, c0: cursor.col, r1: cursor.row, c1: cursor.col }
      const tl = grid.getCellRect?.(r.r0, r.c0)
      const br = grid.getCellRect?.(r.r1, r.c1)
      if (!tl || !br) return null
      const width  = (br.x + br.width)  - tl.x
      const height = (br.y + br.height) - tl.y
      // Motion detection: the row/col/subSheet stamp is what determines
      // whether the *peer* moved. If the stamp is unchanged but the pixel
      // rect differs, that's a local scroll/resize — we leave justMoved
      // false so the cursor teleports with the viewport rather than
      // sliding under the user's mouse.
      const stamp = `${cursor.row}:${cursor.col}:${cursor.subSheet}`
      const prev  = _lastRemoteRC.get(user)
      const justMoved = prev !== undefined && prev !== stamp
      _lastRemoteRC.set(user, stamp)
      return {
        user,
        firstName: cursor.firstName || cursor.initials,
        initials:  cursor.initials,
        color:     cursor.color,
        fullName:  cursor.fullName,
        justMoved,
        style: {
          left:   tl.x + 'px',
          top:    tl.y + 'px',
          width:  width  + 'px',
          height: height + 'px',
          '--rc': cursor.color,
        },
      }
    })
    .filter(Boolean)
})

// ── Lifecycle ─────────────────────────────────────────────────────────────────

// ── Fill handle helpers ───────────────────────────────────────────────────────
// These close over module-level engine vars (sheet, formats, etc.) and the
// module-level `grid` ref (set by _setupGridInstance before any fill fires).

function _fillValidation(src, total, sn) {
  const srcRows = src.r1 - src.r0 + 1, srcCols = src.c1 - src.c0 + 1
  for (let r = total.r0; r <= total.r1; r++) {
    for (let c = total.c0; c <= total.c1; c++) {
      if (r >= src.r0 && r <= src.r1 && c >= src.c0 && c <= src.c1) continue
      const srcR = src.r0 + ((r - src.r0 + srcRows) % srcRows)
      const srcC = src.c0 + ((c - src.c0 + srcCols) % srcCols)
      const rule = validation.get(cellId(srcR, srcC), sn)
      if (rule) validation.set(cellId(r, c), rule, sn)
    }
  }
}

// _runFill modes: 'auto' | 'series' | 'copy' | 'format-only' | 'without-format'
function _runFill(src, total, mode) {
  const sheetName       = sheet.getCurrentSheet()
  const fillBefore      = _captureRange(total, sheetName)
  const beforeFmt       = _captureFormatsRange(total, sheetName)
  const beforeVal       = _captureValidationRange(total, sheetName)
  const beforeMergeSnap = merge.snapshot?.()
  const cfBefore        = condFormat?.getRules?.(sheetName)?.length ?? 0
  if (mode === 'format-only') {
    _fillFormatsOnly(src, total, sheetName)
  } else {
    const valueMode = mode === 'without-format' ? 'auto' : mode
    _fillValues(src, total, sheetName, valueMode)
    if (mode === 'without-format') _clearFormats(src, total, sheetName)
  }
  if (mode !== 'format-only') {
    _fillValidation(src, total, sheetName)
    condFormat.extendRulesToRange(src, total, sheetName)
  }
  // Merges are a structural format — replicate them alongside cell formats
  // (so a merged source tiles its merge into every dragged-over destination)
  // EXCEPT when the user explicitly asked for values-only with `without-format`.
  if (mode !== 'without-format') {
    _fillMerges(src, total, sheetName)
  }
  const fillAfter      = _captureRange(total, sheetName)
  const afterFmt       = _captureFormatsRange(total, sheetName)
  const afterVal       = _captureValidationRange(total, sheetName)
  const afterMergeSnap = merge.snapshot?.()
  const cfAfter        = condFormat?.getRules?.(sheetName)?.length ?? 0
  const refs           = _diffRefs(fillBefore, fillAfter)
  // Server sync — queue the value diff regardless of how history records it.
  if (refs.length) {
    _queueOp({ opType: 'fill', subSheet: sheetName,
               cellRefs: refs, before: fillBefore, after: fillAfter,
               summary: _fillSummary(mode, refs.length) })
  }
  // History — the previous markEdited() path pushed a full snapshot, but
  // history.undo() can't roll a snapshot back when its preceding entry is
  // an op (no earlier snapshot to restore from), so undoing a fill that
  // came after cell edits silently no-op'd the fill and started peeling
  // off the prior cell edits instead — that's the "1, 2 drag-fill to 7,
  // undo clears A2 first" report. The op-based path mirrors paste's
  // shape, which the history's revertOp already round-trips correctly.
  const mergeChanged = JSON.stringify(beforeMergeSnap) !== JSON.stringify(afterMergeSnap)
  const cfChanged    = cfBefore !== cfAfter
  if (refs.length && !cfChanged) {
    history.pushOp({
      opType:    'fill',
      subSheet:  sheetName,
      cellRefs:  refs,
      before:    fillBefore,    after:    fillAfter,
      beforeFormats:    beforeFmt, afterFormats:    afterFmt,
      beforeValidation: beforeVal, afterValidation: afterVal,
      // Merge restore rides on the same op shape now — revertOp/applyOp
      // call merge.restore when these are present.
      ...(mergeChanged ? { beforeMerge: beforeMergeSnap, afterMerge: afterMergeSnap } : {}),
    })
    syncFlags()
    isDirty.value = true
  } else {
    // Conditional-format rules changed — the op shape doesn't model
    // rule restore yet, so fall back to a snapshot. Same snap-after-op
    // edge case applies but only in this narrow path.
    markEdited()
  }
}

function _fillSummary(mode, n) {
  if (mode === 'copy')           return `Copied into ${n} cell${n === 1 ? '' : 's'}`
  if (mode === 'format-only')    return `Filled formats into ${n} cell${n === 1 ? '' : 's'}`
  if (mode === 'without-format') return `Filled (no format) ${n} cell${n === 1 ? '' : 's'}`
  return `Filled ${n} cell${n === 1 ? '' : 's'}`
}

// Read every cell value inside `src` into a 2D array shaped [rows][cols].
function _readSrcGrid(src) {
  const data = []
  for (let r = src.r0; r <= src.r1; r++) {
    const row = []
    for (let c = src.c0; c <= src.c1; c++) row.push(sheet.getCell(cellId(r, c)))
    data.push(row)
  }
  return data
}

function _fillValues(src, total, sheetName, valueMode) {
  const goDown  = total.r1 > src.r1, goUp    = total.r0 < src.r0
  const goRight = total.c1 > src.c1, goLeft  = total.c0 < src.c0

  // Diagonal drags extend `total` in BOTH axes. The original 1D branch ran
  // only the vertical OR horizontal path, leaving the off-axis columns/rows
  // empty (the user's report: drag A1 → C10 only filled A1:A10). Run the
  // vertical phase first; then, treating the now-grown column as the new
  // source, run the horizontal phase. Re-read srcData between phases so
  // computeFillRight sees the freshly written values in each column.

  let workSrc = src
  let srcData = _readSrcGrid(workSrc)
  let srcRows = workSrc.r1 - workSrc.r0 + 1
  let srcCols = workSrc.c1 - workSrc.c0 + 1

  if (goDown || goUp) {
    const count  = goDown ? total.r1 - workSrc.r1 : workSrc.r0 - total.r0
    const dir    = goDown ? 1 : -1
    const filled = computeFillDown(srcData, count, dir, { mode: valueMode })
    const startR = goDown ? workSrc.r1 + 1 : total.r0
    filled.forEach((row, rOff) => row.forEach((val, cOff) => {
      if (typeof val === 'string' && val.startsWith('=')) {
        const srcRowOff = dir > 0 ? rOff % srcRows : ((srcRows - 1 - rOff) % srcRows + srcRows) % srcRows
        val = adjustFormula(val, (startR + rOff) - (workSrc.r0 + srcRowOff), 0)
      }
      sheet.setCell(cellId(startR + rOff, workSrc.c0 + cOff), val)
    }))
    // Expand the working source vertically — phase 2 will spread these full
    // columns sideways across the rest of the destination.
    workSrc = {
      r0: Math.min(workSrc.r0, total.r0),
      r1: Math.max(workSrc.r1, total.r1),
      c0: workSrc.c0,
      c1: workSrc.c1,
    }
    srcData = _readSrcGrid(workSrc)
    srcRows = workSrc.r1 - workSrc.r0 + 1
  }

  if (goRight || goLeft) {
    const count  = goRight ? total.c1 - workSrc.c1 : workSrc.c0 - total.c0
    const dir    = goRight ? 1 : -1
    const filled = computeFillRight(srcData, count, dir, { mode: valueMode })
    const startC = goRight ? workSrc.c1 + 1 : total.c0
    filled.forEach((row, rOff) => row.forEach((val, cOff) => {
      if (typeof val === 'string' && val.startsWith('=')) {
        const srcColOff = dir > 0 ? cOff % srcCols : ((srcCols - 1 - cOff) % srcCols + srcCols) % srcCols
        val = adjustFormula(val, 0, (startC + cOff) - (workSrc.c0 + srcColOff))
      }
      sheet.setCell(cellId(workSrc.r0 + rOff, startC + cOff), val)
    }))
  }
}

// Replicate every merge whose master AND span lie entirely inside `src` into
// each tile of the destination range. Without this, dragging the fill handle
// from a merged source produced unmerged target cells — values copied but
// the structural merge was lost. merge.merge() already unmerges any
// overlapping merge on the target, so re-runs are idempotent.
function _fillMerges(src, total, sn) {
  const srcMerges = []
  for (let r = src.r0; r <= src.r1; r++) {
    for (let c = src.c0; c <= src.c1; c++) {
      const info = merge.getMasterInfo(cellId(r, c), sn)
      if (!info) continue
      if (r + info.rowSpan - 1 > src.r1) continue
      if (c + info.colSpan - 1 > src.c1) continue
      srcMerges.push({ rOff: r - src.r0, cOff: c - src.c0,
                       rowSpan: info.rowSpan, colSpan: info.colSpan })
    }
  }
  if (!srcMerges.length) return

  const srcRows = src.r1 - src.r0 + 1, srcCols = src.c1 - src.c0 + 1
  const goDown  = total.r1 > src.r1, goUp    = total.r0 < src.r0
  const goRight = total.c1 > src.c1, goLeft  = total.c0 < src.c0

  // Same 2-phase pattern as _fillValues: extend vertically first, then walk
  // every column in the vertically-grown source across the horizontal range.
  // For a diagonal drag, this tiles merges into the full 2D destination
  // instead of just the on-axis strip.
  let workR0 = src.r0, workR1 = src.r1
  if (goDown || goUp) {
    const startR = goDown ? src.r1 + 1 : total.r0
    const endR   = goDown ? total.r1   : src.r0 - 1
    for (let tileR0 = startR; tileR0 <= endR; tileR0 += srcRows) {
      for (const m of srcMerges) {
        const r0 = tileR0 + m.rOff
        const c0 = src.c0 + m.cOff
        const r1 = r0 + m.rowSpan - 1
        const c1 = c0 + m.colSpan - 1
        if (r1 > endR) continue   // drop the partial tile at the far edge
        merge.merge(r0, c0, r1, c1, sn)
      }
    }
    workR0 = Math.min(workR0, total.r0)
    workR1 = Math.max(workR1, total.r1)
  }
  if (goRight || goLeft) {
    // Re-enumerate merges over the vertically-grown source so phase 2 also
    // catches every merge tiled in by phase 1.
    const grownMerges = []
    for (let r = workR0; r <= workR1; r++) {
      for (let c = src.c0; c <= src.c1; c++) {
        const info = merge.getMasterInfo(cellId(r, c), sn)
        if (!info) continue
        if (r + info.rowSpan - 1 > workR1) continue
        if (c + info.colSpan - 1 > src.c1) continue
        grownMerges.push({ rOff: r - workR0, cOff: c - src.c0,
                           rowSpan: info.rowSpan, colSpan: info.colSpan })
      }
    }
    const startC = goRight ? src.c1 + 1 : total.c0
    const endC   = goRight ? total.c1   : src.c0 - 1
    for (let tileC0 = startC; tileC0 <= endC; tileC0 += srcCols) {
      for (const m of grownMerges) {
        const r0 = workR0 + m.rOff
        const c0 = tileC0 + m.cOff
        const r1 = r0 + m.rowSpan - 1
        const c1 = c0 + m.colSpan - 1
        if (c1 > endC) continue
        merge.merge(r0, c0, r1, c1, sn)
      }
    }
  }
}

function _fillFormatsOnly(src, total, sn) {
  const srcRows = src.r1 - src.r0 + 1, srcCols = src.c1 - src.c0 + 1
  for (let r = total.r0; r <= total.r1; r++) {
    for (let c = total.c0; c <= total.c1; c++) {
      if (r >= src.r0 && r <= src.r1 && c >= src.c0 && c <= src.c1) continue
      const srcR = src.r0 + ((r - src.r0 + srcRows) % srcRows)
      const srcC = src.c0 + ((c - src.c0 + srcCols) % srcCols)
      const fmt  = formats.get(cellId(srcR, srcC), sn)
      if (fmt && Object.keys(fmt).length) formats.set(cellId(r, c), fmt, sn)
      else                                formats.clear(cellId(r, c), sn)
    }
  }
}

function _clearFormats(src, total, sn) {
  for (let r = total.r0; r <= total.r1; r++) {
    for (let c = total.c0; c <= total.c1; c++) {
      if (r >= src.r0 && r <= src.r1 && c >= src.c0 && c <= src.c1) continue
      formats.clear(cellId(r, c), sn)
    }
  }
}

function _previewSeriesKind(src) {
  const sn  = sheet.getCurrentSheet()
  const sel = grid?.getSelection()
  const goingDown  = sel ? sel.r1 > src.r1 : false
  const goingRight = sel ? sel.c1 > src.c1 : false
  const sampleAlongCol = goingDown || !goingRight
  const vals = []
  if (sampleAlongCol) {
    for (let r = src.r0; r <= src.r1; r++) vals.push(sheet.getCell(cellId(r, src.c0), sn))
  } else {
    for (let c = src.c0; c <= src.c1; c++) vals.push(sheet.getCell(cellId(src.r0, c), sn))
  }
  const series = detectSeries(vals.map(v => v == null ? '' : String(v)))
  return series ? series.kind : null
}

// ── Mount phases ─────────────────────────────────────────────────────────────

function _setupGridInstance() {
  grid = createGrid(canvasRef.value, {
    onSelect(id) {
      activeCell.value   = id
      formulaValue.value = sheet.getCell(id)
      refreshActiveFormat()
      _syncNumberFormat(id)
      computeSelectionStats()
      if (isPaintingFormat.value) _applyPaintedFormat()
      const p = parseCellId(id)
      if (p) {
        // Send the full selection rect so peers can paint a range outline,
        // not just a single anchor cell.
        const sel = grid?.getSelection?.()
        const range = sel
          ? { r0: sel.r0, c0: sel.c0, r1: sel.r1, c1: sel.c1 }
          : null
        broadcastCursor(p.row, p.col, sheet.getCurrentSheet(), range)
      }
    },
    onCommit(id, value) {
      // Cross-sheet path: in-cell overlay was editing on `homeSheet`, user
      // hopped over to another sheet to pick a range, then pressed Enter.
      // Write the formula back to the home sheet and snap the canvas there
      // so the next-row move-down on Enter lands on the home sheet too.
      const homeSheet = editingHomeSheet.value
      const writeSheet = (homeSheet && homeSheet !== sheet.getCurrentSheet()) ? homeSheet : sheet.getCurrentSheet()

      // Protection first — blocks writes AND clears (empty value) on a locked
      // cell. Nothing was written, so repaint the pre-edit value and bail.
      if (_cellBlocked(id, writeSheet)) {
        grid?.render?.()
        editingHomeSheet.value = null
        editingHomeCell.value  = null
        syncFlags()
        return
      }

      // Enforce data validation rules. The engine stores rules in the snapshot
      // and the canvas paints a dropdown arrow for `list` rules, but until
      // now nothing surfaced number / text_length rejection — so "between 1
      // and 10" silently accepted any value. Skip the check for empty values
      // so the user can always clear a cell (matches Google Sheets).
      const trimmed = String(value ?? '').trim()
      if (trimmed !== '') {
        const v = validation.validate(id, value, writeSheet)
        // 'warn' rules let the value through but surface a transient notice;
        // 'reject' (default) blocks the edit and repaints the pre-edit value.
        if (!v.valid && v.severity !== 'warn') {
          const msg = v.message || 'Value rejected by data validation rule'
          saveError.value = msg
          setTimeout(() => { if (saveError.value === msg) saveError.value = '' }, 3500)
          // Force a re-render so the canvas repaints with the pre-edit value
          // (we never called sheet.setCell so the engine still has it).
          grid?.render?.()
          editingHomeSheet.value = null
          editingHomeCell.value  = null
          syncFlags()
          return
        }
        if (!v.valid && v.severity === 'warn') {
          const msg = v.message || 'Value flagged by data validation rule'
          saveError.value = msg
          setTimeout(() => { if (saveError.value === msg) saveError.value = '' }, 3500)
        }
      }

      const before = sheet.getCell(id, writeSheet)
      sheet.setCell(id, value, writeSheet)
      if (writeSheet !== sheet.getCurrentSheet()) {
        switchSheet(writeSheet, { preserveEdit: true })
      }
      if (before !== value) {
        // The same op shape feeds both server sync (_queueOp drains on
        // autosave) and undo history (pushOp keeps it on the local stack).
        // Op-based history replaces the old markEdited → snapshot path:
        // ~750 ms (deep-clone every engine) → ~10 µs (push the op object).
        const op = { opType: 'edit', subSheet: writeSheet,
                     cellRefs: [id], before: { [id]: before }, after: { [id]: value } }
        // Multi-line value (Cmd+Enter) auto-grows its row like Google Sheets.
        // The height diff rides the history op so undo/redo restores it;
        // _queueOp destructures only the known keys, so server sync is
        // unaffected. Row heights live in the current sheet's canvas view,
        // hence the writeSheet guard.
        if (writeSheet === sheet.getCurrentSheet()) {
          const p = parseCellId(id)
          const grow = p && grid?.autoGrowRowFor?.(p.row, p.col, value)
          if (grow) {
            op.beforeRowH = { [p.row]: grow.before }
            op.afterRowH  = { [p.row]: grow.after }
          }
        }
        _queueOp(op)
        history.pushOp(op)
        broadcastCellChange(writeSheet, id, value)
      }
      // Outside the changed-guard: re-committing an unchanged URL text (e.g.
      // pre-existing "frappe.io" data) still picks up its link.
      _maybeAutoLink([{ id, value, before }], writeSheet)
      editingHomeSheet.value = null
      editingHomeCell.value  = null
      syncFlags()
      isDirty.value = true
      recomputePivotsForSheet(writeSheet)
    },
    onInput(id, value)  { formulaValue.value = value },
    onCancel(id)        {
      const homeSheet = editingHomeSheet.value
      if (homeSheet && homeSheet !== sheet.getCurrentSheet()) {
        switchSheet(homeSheet)  // full reset so canvas snaps back to home cell
      }
      editingHomeSheet.value = null
      editingHomeCell.value  = null
      formulaValue.value = sheet.getCell(id)
    },
    getFormat:    id => formats.get(id, sheet.getCurrentSheet()),
    // Lazy render value source (Phase 1, off by default). Mirrors exactly what
    // _repopulateGrid / onCellChanged bake into the grid's eager `data` cache,
    // so the lazy and eager render paths produce identical pixels. When enabled
    // (grid.setLazyValues(true)), the grid pulls this per visible cell instead
    // of materialising every cell up front.
    getDisplay:   _cellDisplay,
    // Non-empty cell ids for the current sheet — the lazy path's source for
    // cold-path scans (Cmd+A extent, autofit) that used to walk the grid's
    // own `data` keys.
    getCellIds:   () => Object.keys(sheet.getRawData()),
    getMergeInfo: id => merge.getMasterInfo(id, sheet.getCurrentSheet()),
    isSlave:      id => merge.isSlave(id, sheet.getCurrentSheet()),
    getMasterId:  id => merge.getMasterId(id, sheet.getCurrentSheet()),
    getComment:   id => comments.hasOpenComment(id, sheet.getCurrentSheet()),
    getValidation: id => validation.get(id, sheet.getCurrentSheet()),
    getCondFormat: (id, val) => condFormat.getFormatOverride(
      id, val, sheet.getCurrentSheet(),
      (cid) => sheet.getDisplayValue(cid, sheet.getCurrentSheet()),
    ),
    // A SPARKLINE formula evaluates to a spec object; the painter draws it.
    // In show-formulas mode the cell shows its =SPARKLINE(...) text instead.
    getSparkline: id => {
      if (showFormulas.value) return null
      const v = sheet.getCellValue(id, sheet.getCurrentSheet())
      return (v && v.__spark) ? v : null
    },
    getRightInset: id => {
      const range = sortFilter.getRange(sheet.getCurrentSheet())
      if (!range) return 0
      const p = parseCellId(id)
      if (!p) return 0
      // Reserve 19px right-padding in the filter header row inside the active range.
      return p.row === range.r0 && p.col >= range.c0 && p.col <= range.c1 ? 19 : 0
    },
    onHyperlinkClick(url) { window.open(url, '_blank', 'noopener,noreferrer') },
    onLinkHover: _onLinkHover,
    onDropdownClick(id, rule, pos) { openDropdown(id, rule, pos) },
    onCheckboxToggle(id) { toggleCheckbox(id) },
    onPivotDrill(r, c) { return drillDownAt(r, c) },
    getSheetNames() { return sheetNames.value },
    // Cross-sheet picker — grid prefixes inserted refs with the current sheet
    // when it differs from the edit's home sheet. Home is null outside of an
    // active cross-sheet edit, in which case the prefix is omitted.
    getCurrentSheet()    { return sheet.getCurrentSheet() },
    getEditingHomeSheet() { return editingHomeSheet.value },
    isCellEditable: (r, c) => !protection.isProtected(r, c, sheet.getCurrentSheet()),
    onBlockedEdit: () => _flashProtected(sheet.getCurrentSheet()),
    onFill(src, total, { withModifier = false } = {}) {
      if (_fillDestBlocked(src, total)) return   // only the destination cells, not the source
      const series = _previewSeriesKind(src)
      // Cmd/Ctrl held inverts the auto-detected mode — Google Sheets behaviour.
      const mode = withModifier ? (series ? 'copy' : 'series') : 'auto'
      _runFill(src, total, mode)
    },
    onBatchCommit(cells) {
      if (_cellsBlocked(cells.map(c => c.id))) return
      const { before, after, refs } = diffCells(cells, id => sheet.getCell(id))
      for (const { id, value } of cells) sheet.setCell(id, value)
      if (refs.length) {
        const op = { opType: 'edit', subSheet: sheet.getCurrentSheet(),
                     cellRefs: refs, before, after,
                     summary: refs.length > 1 ? `Edited ${refs.length} cells` : '' }
        _queueOp(op)
        history.pushOp(op)
        broadcastBatchChange(sheet.getCurrentSheet(), refs.map(id => ({ id, value: after[id] })))
      }
      _maybeAutoLink(
        cells.map(({ id, value }) => ({
          id, value, before: before[id] !== undefined ? before[id] : value,
        })),
        sheet.getCurrentSheet(),
      )
      syncFlags()
      isDirty.value = true
      recomputePivotsForSheet(sheet.getCurrentSheet())
    },
    onResizeEnd() {
      history.push()
      isDirty.value = true
    },
    onColMove(fromCol, toCol, count) {
      if (readOnly.value) return
      doMoveCol(fromCol, toCol, count)
    },
    // Lazy render is the default; eager `data` cache stays as an opt-out
    // fallback (`?lazy=0`). See _lazyValuesEnabled.
    lazyValues: _lazyValuesEnabled(),
    // Gate every in-canvas mutation (begin-edit, delete, fill, resize,
    // checkbox/dropdown) on write permission. Read-only viewers keep
    // selection, navigation and copy.
    canEdit: () => !readOnly.value,
  })
  // Keep DOM overlays (filter chevrons) in sync with canvas scroll/resize/freeze.
  grid.onRender(() => { renderVersion.value++ })
}

function _pinGridWrapScroll() {
  const wrap = gridWrapRef.value
  if (!wrap) return
  if (wrap.scrollTop)  wrap.scrollTop = 0
  if (wrap.scrollLeft) wrap.scrollLeft = 0
}

function _setupEventListeners() {
  canvasRef.value.addEventListener('contextmenu', _onCanvasContextMenu)
  // computeSelectionStats fires from the grid's onSelect callback on every
  // selection change (moveSel + extendSel both emit it). The redundant
  // mouseup/keyup listeners that used to live here doubled the per-event
  // cost — each keypress walked the cell scan twice. Drop them.
  ro = new ResizeObserver(([entry]) => {
    const { width, height } = entry.contentRect
    grid.resize(width, height)
  })
  ro.observe(gridWrapRef.value)
  // Safety net: the grid-wrap must never scroll natively — all scrolling flows
  // through the canvas + custom scrollbars, so its scrollTop/Left are meant to
  // stay 0. An overlay taller/wider than the viewport can still give it
  // scrollable overflow, and a stray focus/scrollIntoView then scrolls it,
  // dragging the canvas off-position. Pin it back the instant that happens.
  gridWrapRef.value.addEventListener('scroll', _pinGridWrapScroll, { passive: true })
  window.addEventListener('keydown',      onGlobalKey)
  window.addEventListener('beforeunload', onBeforeUnloadGuard)
  document.addEventListener('paste',     onDocPaste)
  document.addEventListener('copy',      onDocCopy)
  document.addEventListener('cut',       onDocCut)
  document.addEventListener('mousedown', _onDocMouseDown)
  // Re-arm the grid for paste when the user switches back to this window
  // (copied from another app) or back to this tab, so Cmd+V works without a
  // priming click. 'focus' covers app/window switches; 'visibilitychange'
  // covers tab switches within the same window.
  window.addEventListener('focus',              _refocusGridIfIdle)
  document.addEventListener('visibilitychange', _refocusGridIfIdle)
}

async function _loadInitialData() {
  history.init()
  syncFlags()
  if (props.id && props.id !== 'new') {
    await loadSheet(props.id)
    // sheet.restore() now fires onCellsChanged → _repopulateGrid() as a
    // single bulk pass, so the explicit call here was duplicating work
    // (parseCellId + grid.setCell × every cell, on top of the per-cell
    // notification cascade we already paid). The view-state catch-up below
    // doesn't depend on the canvas being painted, so it's safe to skip.
    const restored = grid.viewSnapshot?.()
    if (restored) {
      freezeRows.value = restored.freezeRows || 0
      freezeCols.value = restored.freezeCols || 0
      // Legacy docs (saved before filter hides were split out of the view)
      // baked the active sheet's filter rows into hiddenRows. Strip the
      // sheet's current filter rows so they aren't mistaken for manual hides
      // and re-applied to every sheet. Harmless for clean docs.
      const filterHidden = new Set(sortFilter.computeHiddenRows(sheet.getCurrentSheet()))
      manualHiddenRows.clear()
      for (const r of (restored.hiddenRows || [])) if (!filterHidden.has(r)) manualHiddenRows.add(r)
      manualHiddenCols.clear(); for (const c of (restored.hiddenCols || [])) manualHiddenCols.add(c)
    }
    // The view now holds manual hides only; re-apply the active sheet's filter
    // so a saved filter still shows its hidden rows on first load.
    _applyHiddenRows()
    syncNames()
    activeCell.value   = 'A1'
    formulaValue.value = sheet.getCell('A1')
    refreshActiveFormat()
    _syncNumberFormat('A1')
    // Re-baseline history to the loaded state. The pre-load init() above
    // seeded an EMPTY snapshot; a plain init() here is a no-op (stack already
    // seeded), which would leave the empty snapshot as the undo baseline and
    // blank the sheet on the first snapshot-based undo (e.g. insert column).
    history.reset()
    syncFlags()
  } else if (props.id === 'new') {
    // Google-Sheets model: create the doc immediately so there is never an
    // "unsaved" state.  The parent swaps the URL to ?id=<name> via onSaved.
    const name = await autoCreate(currentTitle.value || 'Untitled Sheet')
    if (name) emit('saved', name)
  }
}

// Drives the canvas loading overlay (sn-canvas-loading). True until
// _loadInitialData has either populated the engines from get_sheet or
// surfaced a load error — flipped in a finally so a thrown exception
// never strands the editor with a permanent spinner.
const isInitialLoad = ref(true)

onMounted(async () => {
  _setupGridInstance()
  _setupEventListeners()
  try {
    await _loadInitialData()
  } finally {
    isInitialLoad.value = false
  }
  // Focus the grid on open so arrow-key nav and Cmd+V work immediately, without
  // a priming click. Idle-guarded so a load that opened a dialog keeps its focus.
  _refocusGridIfIdle()
})

onBeforeUnmount(() => {
  clearTimeout(_autoSaveTimer)
  // CRITICAL: flush any pending debounced save before the component dies.
  // Without this, navigating away within ~2s of an edit (the autosave
  // debounce window) silently drops the most recent changes — exactly the
  // "data is lost when I come back" report. The fetch uses `keepalive: true`
  // so the request survives the unmount.
  if (isDirty.value && !readOnly.value && props.id && props.id !== 'new') {
    saveExisting(props.id, currentTitle.value, { keepalive: true })
  }
  window.removeEventListener('beforeunload', onBeforeUnloadGuard)
  gridWrapRef.value?.removeEventListener('scroll', _pinGridWrapScroll)
  ro?.disconnect()
  grid?.destroy()
  window.removeEventListener('keydown', onGlobalKey)
  document.removeEventListener('paste',     onDocPaste)
  document.removeEventListener('copy',      onDocCopy)
  document.removeEventListener('cut',       onDocCut)
  document.removeEventListener('mousedown', _onDocMouseDown)
  window.removeEventListener('focus',              _refocusGridIfIdle)
  document.removeEventListener('visibilitychange', _refocusGridIfIdle)
})

// ── Save ──────────────────────────────────────────────────────────────────────

// Browser-level guard (tab close / refresh / cross-app nav). The native
// "Leave site?" prompt is the only thing that can preempt a unload reliably.
function onBeforeUnloadGuard(e) {
  if (!isDirty.value) return
  e.preventDefault()
  e.returnValue = ''   // Chrome requires returnValue to show the prompt
}

let _autoSaveTimer = null
let _savePromise = null
let _pendingSaveBatch = null

// Operation queue — populated by _queueOp() at write sites (paste, fill,
// import, cell edit, etc.).  Flushed after each successful save so each
// op is hard-linked to the Version row it produced.  See versions.py
// record_op + list_versions for the consumer side.
const _opQueue = []
function _queueOp({ opType, cellRefs = null, before = null, after = null,
                    summary = '', subSheet = '' }) {
	if (props.id === 'new') return        // pre-save doc has no version yet
	_opQueue.push({ opType, cellRefs, before, after, summary, subSheet })
}

// Snapshot {id → value} for a rectangular cell range, used before/after each
// write so ops carry their own diff.  Caller passes the active sub-sheet.
function _captureRange(rect, sheetName) {
	const out = {}
	if (!rect) return out
	const sn = sheetName || sheet.getCurrentSheet()
	for (let r = rect.r0; r <= rect.r1; r++) {
		for (let c = rect.c0; c <= rect.c1; c++) {
			const id = cellId(r, c)
			out[id] = sheet.getCell(id, sn)
		}
	}
	return out
}

// Snapshot {id → format} for the rect. Used by paste/fill ops so undo
// can revert the format changes too — without this the value-only op
// shape would leave pasted formats stuck on undo, contradicting the
// old snapshot-based history's full revert.
function _captureFormatsRange(rect, sheetName) {
	const out = {}
	if (!rect) return out
	const sn = sheetName || sheet.getCurrentSheet()
	for (let r = rect.r0; r <= rect.r1; r++) {
		for (let c = rect.c0; c <= rect.c1; c++) {
			const id = cellId(r, c)
			out[id] = formats.getCellFormat(id, sn) || null
		}
	}
	return out
}

// Record a cell-level format change to `ids` as an op DIFF instead of a full
// history.push() snapshot (the snapshot deep-clones every cell — ~2s on a
// 2M-cell sheet, ×50 in the undo stack). Captures cell-LEVEL formats so undo
// restores the cell layer without baking column/row formats into cells.
// Used by handlers that must touch cells directly (number formats bake the
// display string per cell). `mutate` runs between the before/after captures.
function _recordFormatOp(ids, sn, mutate) {
	const beforeFormats = {}
	for (const id of ids) beforeFormats[id] = formats.getCellFormat(id, sn) || null
	mutate()
	const afterFormats = {}
	for (const id of ids) afterFormats[id] = formats.getCellFormat(id, sn) || null
	history.pushOp({ opType: 'format', subSheet: sn, beforeFormats, afterFormats })
}

// Scope-aware variant for VISUAL formats (font, size, painted format) that the
// renderer resolves live via the column<row<cell cascade. Full-column /
// full-row selections write one layer entry instead of per-cell records, so
// "set font on the whole sheet" stays tiny and instant. `ops` supplies the
// three mutation variants: { cols, rows, cells }.
function _recordScopedFormatOp(ops) {
	const sn = sheet.getCurrentSheet()
	const info = _selectionScope()
	const scope = info ? formatScope(info.rect, info.totalRows, info.totalCols) : { kind: 'cells' }
	const op = { opType: 'format', subSheet: sn }
	if (scope.kind === 'cols') {
		op.beforeCols = _captureAxis('col', scope.cols, sn)
		ops.cols(scope.cols, sn)
		op.afterCols = _captureAxis('col', scope.cols, sn)
	} else if (scope.kind === 'rows') {
		op.beforeRows = _captureAxis('row', scope.rows, sn)
		ops.rows(scope.rows, sn)
		op.afterRows = _captureAxis('row', scope.rows, sn)
	} else {
		const ids = selectionIds()
		op.beforeFormats = {}
		for (const id of ids) op.beforeFormats[id] = formats.getCellFormat(id, sn) || null
		ops.cells(ids, sn)
		op.afterFormats = {}
		for (const id of ids) op.afterFormats[id] = formats.getCellFormat(id, sn) || null
	}
	history.pushOp(op)
}

function _captureAxis(axis, keys, sn) {
	const get = axis === 'col' ? formats.getCol : formats.getRow
	const out = {}
	for (const k of keys) out[k] = get(k, sn) || null
	return out
}

function _captureValidationRange(rect, sheetName) {
	const out = {}
	if (!rect) return out
	const sn = sheetName || sheet.getCurrentSheet()
	for (let r = rect.r0; r <= rect.r1; r++) {
		for (let c = rect.c0; c <= rect.c1; c++) {
			const id = cellId(r, c)
			out[id] = validation.get(id, sn) || null
		}
	}
	return out
}

// Every cell a paste can touch — used so the paste's before/after capture
// (and thus undo) covers all of it:
//   1. the destination selection (tiled pastes fill exactly this),
//   2. the paste's output rect — anchor + buffer dimensions — so a single-cell
//      selection still records the whole pasted block, and
//   3. for a cut, the source range the paste vacates; its cells are cleared,
//      and any outside the destination would otherwise be lost on undo.
// Returns an array of rects; callers merge per-cell captures across them.
// Must be called BEFORE clipboard.paste(), which consumes the cut buffer.
function _pasteAffectedRects(destSel) {
	const rects = destSel ? [destSel] : []
	const src = clipboard.getSourceSel()
	if (src) {
		const anch = parseCellId(activeCell.value)
		if (anch) rects.push({
			r0: anch.row, c0: anch.col,
			r1: anch.row + (src.r1 - src.r0),
			c1: anch.col + (src.c1 - src.c0),
		})
		if (clipboard.getMode() === 'cut') rects.push(src)
	}
	return rects
}

// ── Protection enforcement ────────────────────────────────────────────────────
// The single gate every user-initiated write consults. Each helper returns true
// — and flashes a transient notice — when the target is protected, so callers
// bail with `if (…) return`. Programmatic paths (undo/restore/collab) never call
// these, so they can still rewrite protected cells.
//
// A dedicated notice ref — NOT saveError — so a "protected" message renders as a
// neutral badge and doesn't arm the save-error watchdog / retry affordance.
const protectionNotice = ref('')
function _flashProtected(sn) {
  const msg = protection.isSheetLocked(sn)
    ? 'This sheet is protected'
    : 'This range is protected and can’t be edited'
  protectionNotice.value = msg
  setTimeout(() => { if (protectionNotice.value === msg) protectionNotice.value = '' }, 3500)
}
function _rectBlocked(rect, sn = sheet.getCurrentSheet()) {
  if (!rect || !protection.isAnyProtected(rect, sn)) return false
  _flashProtected(sn); return true
}
function _cellBlocked(id, sn = sheet.getCurrentSheet()) {
  const p = parseCellId(id)
  if (!p || !protection.isProtected(p.row, p.col, sn)) return false
  _flashProtected(sn); return true
}
function _cellsBlocked(ids, sn = sheet.getCurrentSheet()) {
  const hit = ids.some(id => _cellSilentlyProtected(id, sn))
  if (hit) _flashProtected(sn)
  return hit
}
function _cellSilentlyProtected(id, sn = sheet.getCurrentSheet()) {
  const p = parseCellId(id)
  return !!(p && protection.isProtected(p.row, p.col, sn))
}
// A fill writes only the destination — the strip(s) of `total` outside `src`.
// Checking the whole extent would wrongly block a fill that merely *starts*
// from a protected cell (reading a protected source is fine; only writes are
// guarded). A fill extends in one direction, so at most one strip is non-empty.
function _fillDestBlocked(src, total, sn = sheet.getCurrentSheet()) {
  const strips = []
  if (total.r1 > src.r1) strips.push({ r0: src.r1 + 1, r1: total.r1, c0: total.c0, c1: total.c1 })
  if (total.r0 < src.r0) strips.push({ r0: total.r0, r1: src.r0 - 1, c0: total.c0, c1: total.c1 })
  if (total.c1 > src.c1) strips.push({ r0: total.r0, r1: total.r1, c0: src.c1 + 1, c1: total.c1 })
  if (total.c0 < src.c0) strips.push({ r0: total.r0, r1: total.r1, c0: total.c0, c1: src.c0 - 1 })
  if (!strips.some(s => protection.isAnyProtected(s, sn))) return false
  _flashProtected(sn); return true
}

// ── Protection UI actions ─────────────────────────────────────────────────────
function protectSelection() {
  contextMenu.open = false
  const sel = grid?.getSelection?.()
  if (!sel) return
  protection.addRange(sel, '', sheet.getCurrentSheet())
  history.push()
  isDirty.value = true
  grid?.render?.()
}
function unprotectSelection() {
  contextMenu.open = false
  const sel = grid?.getSelection?.()
  if (!sel) return
  const sn = sheet.getCurrentSheet()
  // Drop every protected range that overlaps the selection.
  for (const r of [...protection.getRanges(sn)]) {
    if (sel.r0 <= r.r1 && sel.r1 >= r.r0 && sel.c0 <= r.c1 && sel.c1 >= r.c0) {
      protection.removeRange(r.id, sn)
    }
  }
  history.push()
  isDirty.value = true
  grid?.render?.()
}
function toggleSheetProtection(name) {
  tabMenu.open = false
  protection.setSheetLocked(!protection.isSheetLocked(name), name)
  history.push()
  isDirty.value = true
  grid?.render?.()
}
// Menu-label reads. These are plain functions (not computed) so the template
// re-evaluates them against the live selection each time the menu re-renders —
// a computed would cache a stale answer when neither dep happened to change.
// selectionHasProtectedRange looks only at ranges: the whole-sheet lock is a
// separate affordance in the tab menu, so "Remove protection" here never lies
// about a lock it can't clear.
function selectionHasProtectedRange() {
  const sel = grid?.getSelection?.()
  if (!sel) return false
  const sn = sheet.getCurrentSheet()
  return protection.getRanges(sn).some(r =>
    sel.r0 <= r.r1 && sel.r1 >= r.r0 && sel.c0 <= r.c1 && sel.c1 >= r.c0)
}
function tabMenuSheetLocked() {
  return !!tabMenu.name && protection.isSheetLocked(tabMenu.name)
}

// Diff two id→value maps, returning the ids whose value changed.  Used to
// trim noisy before/after pairs down to the cells that actually moved.
function _diffRefs(before, after) {
	const ids = new Set([...Object.keys(before || {}), ...Object.keys(after || {})])
	return [...ids].filter(id => (before?.[id]) !== (after?.[id]))
}

// Per-op cap on the serialized before/after JSON. Anything larger drops
// the heavy fields and falls back to a lightweight summary — the new state
// still lives in sheets_data, and the prior state can be reconstructed from
// the preceding snapshot, so we lose nothing audit-wise. Without this, a
// large CSV import builds a 20+ MB op that blows past nginx's body cap and
// the server returns an HTML 413 instead of JSON.
const _MAX_OP_PAYLOAD_BYTES = 64 * 1024

// Snapshot the queue without removing entries. They are removed only after the
// save succeeds, so a failed save can retry without losing operation history.
function _opsForSave() {
	if (!_opQueue.length || props.id === 'new') return { ops: [], count: 0 }
	const batch = _opQueue.slice()
	return { ops: batch.map(_serialiseOp), count: batch.length }
}

function _serialiseOp(op) {
	const cellRefsJson = op.cellRefs ? JSON.stringify(op.cellRefs) : undefined
	const beforeJson   = op.before   ? JSON.stringify(op.before)   : undefined
	const afterJson    = op.after    ? JSON.stringify(op.after)    : undefined
	const heavy = (beforeJson?.length || 0) + (afterJson?.length || 0)
	const truncated = heavy > _MAX_OP_PAYLOAD_BYTES
	return {
		op_type:   op.opType,
		sub_sheet: op.subSheet || undefined,
		cell_refs: cellRefsJson,
		before:    truncated ? undefined : beforeJson,
		after:     truncated ? undefined : afterJson,
		summary:   truncated ? _truncatedSummary(op) : (op.summary || undefined),
	}
}

function _truncatedSummary(op) {
	const base  = op.summary || op.opType || 'bulk edit'
	const count = Array.isArray(op.cellRefs) ? op.cellRefs.length : 0
	return count ? `${base} (${count} cells, details truncated)` : base
}

function _triggerAutoSave() {
  clearTimeout(_autoSaveTimer)
  _autoSaveTimer = setTimeout(_doAutoSave, 2000)
}

async function _doAutoSave() {
  if (_savePromise) await _savePromise
  if (!isDirty.value) return
  // Backstop: a viewer should never reach save_sheet (which would throw
  // PermissionError). The input layer already blocks their edits, so isDirty
  // stays false — but guard here too in case a mutation path is ever missed.
  if (readOnly.value) return
  // Bootstrap is handled by _loadInitialData's autoCreate(); calling
  // saveExisting('new') would explode with "Sheet new not found". If the
  // bootstrap save failed for any reason, leave it to a subsequent reload
  // rather than spamming the server on every typed character.
  if (props.id === 'new') return
  isDirty.value = false
  // Drain queued ops BEFORE the save so the batch lands atomically with the
  // implicit `save` op and keeps the canonical user-action ordering intact.
  const batch = _pendingSaveBatch || { ..._opsForSave(), revision: _dirtyRevision }
  _pendingSaveBatch = batch
  _savePromise = _pendingSaveBatch.failed
    ? retrySave()
    : saveExisting(props.id, currentTitle.value, { ops: batch.ops })
  await _savePromise
  _savePromise = null
  if (saveError.value) {
    batch.failed = true
    isDirty.value = true
    return
  }
  _opQueue.splice(0, batch.count)
  _pendingSaveBatch = null
  isDirty.value = _dirtyRevision > batch.revision
  justSaved.value = true
  setTimeout(() => { justSaved.value = false }, 2500)
}

async function flushSave() {
  clearTimeout(_autoSaveTimer)
  do {
    await _doAutoSave()
  } while (isDirty.value && !saveError.value)
}

// Manual retry handler — bound to the refresh button next to the
// save-error chip. Routes through _doAutoSave (rather than calling
// retrySave directly) so freshly-queued ops since the last failure
// also ride along, and so the dirty/justSaved flags are managed in
// one place. If somehow the user clicked retry from a sheet that
// isn't dirty (rare race), still try once via retrySave.
async function onRetrySave() {
  if (isSaving.value) return
  if (isDirty.value && props.id && props.id !== 'new') {
    await _doAutoSave()
  } else {
    await retrySave()
  }
}

// Watchdog: when a save has failed but we still have unsaved work,
// nudge another attempt after 30 s without waiting for the user to
// type something else. Catches the "user stepped away during a flaky
// network blip and came back to find their last change lost" case.
let _saveWatchdogTimer = null
watch(saveError, (msg) => {
  clearTimeout(_saveWatchdogTimer)
  if (!msg) return
  _saveWatchdogTimer = setTimeout(() => {
    if (saveError.value && isDirty.value && !isSaving.value
        && props.id && props.id !== 'new') {
      _doAutoSave()
    }
  }, 30_000)
})

async function flushAndClose() {
  await flushSave()
  emit('close')
}

// Watch for any dirty change → schedule auto-save
watch(isDirty, (dirty) => { if (dirty) _triggerAutoSave() })

// Re-render the canvas when the filter row is toggled so row-0 cells reserve
// (or release) right-padding for the chevron buttons.
watch(showSortFilter, () => { grid?.render?.() })

// Title focus/blur — mark `isDirty` when the value changed during the focus
// session so `_doAutoSave` doesn't bail on its `!isDirty` guard. Without
// this, a rename-then-leave flow (no cell edit in between) silently dropped
// the new title: the 2 s autosave ran but exited early, and `flushAndClose`
// → `flushSave` did the same. Snapshotting on focus avoids spurious saves
// when the user just clicks into and out of the field without typing.
let _titleAtFocus = ''
function startTitleEditing() {
  _titleAtFocus = currentTitle.value
  isTitleEditing.value = true
}
function finishTitleEditing() {
  if (!isTitleEditing.value) return
  if (currentTitle.value !== _titleAtFocus) isDirty.value = true
  isTitleEditing.value = false
  _triggerAutoSave()
}
function cancelTitleEditing() {
  currentTitle.value = _titleAtFocus
  isTitleEditing.value = false
}

watch(isSaving, (cur, prev) => { if (prev && !cur && !saveError.value) isDirty.value = false })

function onSave() { _doAutoSave() }

// ── Formula bar ───────────────────────────────────────────────────────────────

function onFormulaInput(e) {
  formulaValue.value = e.target.value
  updateAc(e.target.value, e.target.selectionStart)
}

function onFormulaKey(e) {
  if (acVisible.value) {
    if (e.key === 'ArrowDown') { e.preventDefault(); acIdx.value = Math.min(acIdx.value + 1, acItems.value.length - 1); return }
    if (e.key === 'ArrowUp')   { e.preventDefault(); acIdx.value = Math.max(acIdx.value - 1, 0); return }
    if ((e.key === 'Tab' || e.key === 'Enter') && acItems.value[acIdx.value]) { e.preventDefault(); commitAc(acItems.value[acIdx.value]); return }  // item obj
    if (e.key === 'Escape') { acItems.value = []; return }
  }
  // Auto-close parens in the formula bar, mirroring the in-cell editor.
  const ac = autoCloseKey(e.key, e.target.value, e.target.selectionStart, e.target.selectionEnd)
  if (ac) {
    e.preventDefault()
    const el = e.target
    formulaValue.value = ac.value
    updateAc(ac.value, ac.caret)
    nextTick(() => el.setSelectionRange(ac.caret, ac.caret))
    return
  }
  if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault()
    _commitFormulaBar()
    canvasRef.value?.focus()
  }
  if (e.key === 'Escape') {
    _cancelFormulaBar()
    canvasRef.value?.focus()
  }
}

// Write the in-progress formula back to the cell it was started on, even if
// the user wandered off to another sheet to pick a range. If there's no
// cross-sheet edit, this collapses to the legacy "write to activeCell" path.
function _commitFormulaBar() {
  const homeSheet   = editingHomeSheet.value
  const homeCell    = editingHomeCell.value
  const targetSheet = homeSheet || sheet.getCurrentSheet()
  const targetId    = homeCell  || activeCell.value
  // Protected target — discard the edit and restore the bar to the cell value.
  if (_cellBlocked(targetId, targetSheet)) {
    editingHomeSheet.value = null
    editingHomeCell.value  = null
    formulaValue.value = sheet.getCell(targetId, targetSheet)
    return
  }
  const before      = { [targetId]: sheet.getCell(targetId, targetSheet) }
  if (homeSheet && homeSheet !== sheet.getCurrentSheet()) {
    switchSheet(homeSheet, { preserveEdit: true })
    sheet.setCell(homeCell, formulaValue.value, homeSheet)
  } else {
    sheet.setCell(activeCell.value, formulaValue.value)
  }
  editingHomeSheet.value = null
  editingHomeCell.value  = null
  _pushEditOp(targetSheet, before, 'Edit cell')
  _maybeAutoLink([{ id: targetId, value: formulaValue.value, before: before[targetId] }], targetSheet)
}

function _cancelFormulaBar() {
  const homeSheet = editingHomeSheet.value
  const homeCell  = editingHomeCell.value
  if (homeSheet && homeSheet !== sheet.getCurrentSheet()) {
    // Return to the home sheet *without* preserveEdit so activeCell snaps
    // back to where the user started and formulaValue reflects the cell's
    // committed contents (i.e. the edit is discarded cleanly).
    switchSheet(homeSheet)
    activeCell.value   = homeCell
    formulaValue.value = sheet.getCell(homeCell, homeSheet)
  } else {
    formulaValue.value = sheet.getCell(activeCell.value)
  }
  editingHomeSheet.value = null
  editingHomeCell.value  = null
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────

function fillDown() {
  if (!grid) return
  const { r0, c0, r1, c1 } = grid.getSelection()
  if (r1 <= r0) return
  const sn = sheet.getCurrentSheet()
  if (_rectBlocked({ r0: r0 + 1, c0, r1, c1 }, sn)) return
  const before = {}
  for (let c = c0; c <= c1; c++) {
    for (let r = r0 + 1; r <= r1; r++) {
      const id = colLabel(c) + (r + 1)
      before[id] = sheet.getCell(id, sn)
    }
  }
  for (let c = c0; c <= c1; c++) {
    const srcVal = sheet.getCell(colLabel(c) + (r0 + 1))
    for (let r = r0 + 1; r <= r1; r++) {
      const val = typeof srcVal === 'string' && srcVal.startsWith('=')
        ? adjustFormula(srcVal, r - r0, 0) : srcVal
      sheet.setCell(colLabel(c) + (r + 1), val)
    }
  }
  _pushEditOp(sn, before, 'Fill down')
}

function fillRight() {
  if (!grid) return
  const { r0, c0, r1, c1 } = grid.getSelection()
  if (c1 <= c0) return
  const sn = sheet.getCurrentSheet()
  if (_rectBlocked({ r0, c0: c0 + 1, r1, c1 }, sn)) return
  const before = {}
  for (let r = r0; r <= r1; r++) {
    for (let c = c0 + 1; c <= c1; c++) {
      const id = colLabel(c) + (r + 1)
      before[id] = sheet.getCell(id, sn)
    }
  }
  for (let r = r0; r <= r1; r++) {
    const srcVal = sheet.getCell(colLabel(c0) + (r + 1))
    for (let c = c0 + 1; c <= c1; c++) {
      const val = typeof srcVal === 'string' && srcVal.startsWith('=')
        ? adjustFormula(srcVal, 0, c - c0) : srcVal
      sheet.setCell(colLabel(c) + (r + 1), val)
    }
  }
  _pushEditOp(sn, before, 'Fill right')
}

// Mirrors `clipboard.hasData()` reactively so the context menu can show /
// hide its Paste-Special entries without polling.
const clipboardHas = ref(false)

// Keyboard-driven insert/delete of rows or columns (Ctrl+Alt+= / Ctrl+Alt+-).
// The context-menu handlers key off contextMenu.target{Row,Col}, which only a
// right-click normally populates — so seed it from the live selection first. A
// whole-column selection acts on columns; anything else acts on rows (matching
// Google Sheets). The delete/insert span (N selected lines) flows from the
// selection the same way the right-click menu computes it.
function _insertRowsColsFromSelection() {
  if (readOnly.value) return
  const s = grid?.getSelection?.()
  if (!s) return
  if (s.mode === 'col') { contextMenu.targetCol = s.c0; doInsertCol(false, s.c1 - s.c0 + 1) }
  else                  { contextMenu.targetRow = s.r0; doInsertRow(false, s.r1 - s.r0 + 1) }
}
function _deleteRowsColsFromSelection() {
  if (readOnly.value) return
  const s = grid?.getSelection?.()
  if (!s) return
  if (s.mode === 'col') { contextMenu.targetCol = s.c0; doDeleteCol() }
  else                  { contextMenu.targetRow = s.r0; doDeleteRow() }
}

const { onGlobalKey } = useShortcuts({
  formulaInputEl:           () => formulaInputRef.value,
  undo, redo, onSave, toggleFmt, repeatLast, toggleShowFormulas,
  showFindReplace, openFindReplace,
  openVersionHistory, openHyperlinkDialog, openCommentPanel, openQuickFilterForActive,
  zoomBy, resetZoom,
  commentPanel, dropdownPanel, splitText,
  revertSplitPreview: _revertSplitPreview, closeSplit: _closeSplit,
  clipboard, clipboardHas, setMarchingAnts: (v) => grid?.setMarchingAnts(v),
  fillDown, fillRight,
  runSmartFill,
  insertRowsCols:    _insertRowsColsFromSelection,
  deleteRowsCols:    _deleteRowsColsFromSelection,
  applyNumberFormat: onNumberFormatChange,
  pasteValues:       () => doPasteSpecial('values'),
  readOnly: () => readOnly.value,
})

// ── Clipboard ─────────────────────────────────────────────────────────────────

function _canvasActive() {
  return isCanvasClipboardTarget({
    activeEl:  document.activeElement,
    canvasEl:  canvasRef.value,
    formulaEl: formulaInputRef.value,
    gridWrap:  gridWrapRef.value,
    editing:   grid?.isEditing?.() ?? false,
  })
}

// Returning to the tab or the sheet route leaves browser focus on <body>, not
// the grid, so a Cmd+V fires a paste event the canvas never receives (onDocPaste
// bails at the _canvasActive guard) — the "I have to click a cell first before
// paste works" report. Pull focus back to the canvas, but ONLY when focus has
// landed on nothing (body/null); never steal it from the formula bar, an inline
// cell editor, or an open dialog.
function _refocusGridIfIdle() {
  if (document.visibilityState === 'hidden') return
  const ae = document.activeElement
  if (ae && ae !== document.body) return
  canvasRef.value?.focus()
}

function onDocCopy(e) {
  if (!_canvasActive()) return
  e.preventDefault()
  const src = grid.getSelection()
  clipboard.copy(src)
  clipboardHas.value = true
  grid.setMarchingAnts(src)
}
function onDocCut(e) {
  if (!_canvasActive()) return
  if (readOnly.value) return   // cut deletes cells — viewers may only copy

  e.preventDefault()
  const src    = grid.getSelection()
  const sn     = sheet.getCurrentSheet()
  // Cut moves content out of the source — block it when the source is protected.
  if (_rectBlocked(src, sn)) return
  const before = _captureRange(src, sn)
  clipboard.cut(src)
  clipboardHas.value = true
  grid.setMarchingAnts(src)
  _pushEditOp(sn, before, 'Cut')
}
async function onDocPaste(e) {
  if (!_canvasActive()) return
  if (readOnly.value) return   // viewers can't write pasted cells
  e.preventDefault()
  const destSel = grid.getSelection()
  const sn = sheet.getCurrentSheet()

  // Pasting a copied pivot mints a new live pivot at the anchor rather than
  // writing cells, so the op-based cell-diff undo below can't capture it (it
  // would leave the rendered cells without their _pivots registry entry).
  // Await the async render, then take one full history.push() snapshot, which
  // captures both the pivot registry and the written cells atomically.
  if (clipboard.hasData() && clipboard.getPivotBlob?.()) {
    if (_rectBlocked(destSel, sn)) return   // a pivot paste bypasses the cell-write guard
    await clipboard.paste(activeCell.value, () => {}, 'all', destSel)
    clipboardHas.value = clipboard.hasData()
    grid.setMarchingAnts(null)
    formulaValue.value = sheet.getCell(activeCell.value)   // fx bar tracks the pasted anchor
    history.push()
    isDirty.value = true
    return
  }

  // Prefer the HTML flavor when it carries a real table — external apps
  // (Gameplan, Google Sheets, web pages) put a structured <table> there, while
  // their text/plain flavor can lack tab delimiters and collapse into a single
  // column. Read both flavors up front so we can also MEASURE the paste extent
  // before writing (see below).
  const html = clipboard.hasData() ? null : e.clipboardData?.getData('text/html')
  const text = clipboard.hasData() ? null : e.clipboardData?.getData('text/plain')

  // For an external paste there is no internal source selection, so
  // _pasteAffectedRects only sees the clicked cell — the output block's real
  // size lives in the clipboard payload. Measure it (side-effect free, same
  // grid math the write uses) and fold it into the capture rect, or undo would
  // record only the anchor cell and leave the rest of the block behind.
  const externalRect = clipboard.hasData()
    ? null
    : (clipboard.measureHTMLPaste(html, activeCell.value, destSel)
       ?? clipboard.measureTextPaste(text, activeCell.value, destSel))

  // Snapshot the pre-paste state for cells + formats + validation across
  // the destination rect, plus cond-format rule count for the fallback
  // decision. The cells+formats+validation diff drives op-based undo; if
  // the paste also added a cond-format rule, the rule list isn't part of
  // the op and we'd lose it on undo — fall back to a full snapshot in
  // that rarer case.
  // Capture across everything the paste can touch (dest, full output block,
  // and — for a cut — the vacated source) so undo restores all of it.
  const rects      = _pasteAffectedRects(destSel)
  if (externalRect) rects.push(externalRect)
  const before     = Object.assign({}, ...rects.map(r => _captureRange(r, sn)))
  const beforeFmt  = Object.assign({}, ...rects.map(r => _captureFormatsRange(r, sn)))
  const beforeVal  = Object.assign({}, ...rects.map(r => _captureValidationRange(r, sn)))
  const cfBefore   = condFormat?.getRules?.(sn)?.length ?? 0

  let pasted = false
  if (clipboard.hasData()) {
    // Internal cut/copy — empty historyPush callback so we control the
    // history entry from out here. clipboard still does its mutations.
    // A protected destination returns { blocked } and writes nothing; leave
    // the marching ants + cut buffer intact so the user can retry elsewhere.
    if (clipboard.paste(activeCell.value, () => {}, 'all', destSel)?.blocked) { _flashProtected(sn); return }
    pasted = true
  } else {
    // Prefer a real HTML table; fall back to plain text. Either write into a
    // protected cell returns { blocked } and we bail without recording it.
    const htmlRes = html ? clipboard.pasteFromHTML(html, activeCell.value, () => {}, destSel) : false
    if (htmlRes?.blocked) { _flashProtected(sn); return }
    if (htmlRes) {
      pasted = true
    } else if (text) {
      if (clipboard.pasteFromText(text, activeCell.value, () => {}, destSel)?.blocked) { _flashProtected(sn); return }
      pasted = true
    }
  }
  clipboardHas.value = clipboard.hasData()
  grid.setMarchingAnts(null)
  if (pasted) {
    // Refresh display strings for every touched rect — the engine already
    // notified for cell-value changes, but format changes happened AFTER
    // batchSetCells so the canvas painted those cells with the old
    // format, and a cut's vacated source needs to repaint as empty.
    for (const r of rects) _refreshDisplayForRange(r, sn)
    formulaValue.value = sheet.getCell(activeCell.value)   // fx bar tracks the pasted anchor
    const after    = Object.assign({}, ...rects.map(r => _captureRange(r, sn)))
    const afterFmt = Object.assign({}, ...rects.map(r => _captureFormatsRange(r, sn)))
    const afterVal = Object.assign({}, ...rects.map(r => _captureValidationRange(r, sn)))
    const cfAfter  = condFormat?.getRules?.(sn)?.length ?? 0
    const refs     = _diffRefs(before, after)
    if (refs.length || cfBefore !== cfAfter) {
      _queueOp({ opType: 'paste', subSheet: sn, cellRefs: refs,
                 before, after,
                 summary: `Pasted into ${refs.length} cell${refs.length === 1 ? '' : 's'}` })
      _pushPasteHistory({
        opType: 'paste', subSheet: sn, cellRefs: refs,
        before, after,
        beforeFormats: beforeFmt, afterFormats: afterFmt,
        beforeValidation: beforeVal, afterValidation: afterVal,
        cfChanged: cfBefore !== cfAfter,
      })
      syncFlags()
    }
    isDirty.value = true
  }
}

// Right-click → Paste special. `kind` ∈ {'values', 'formats', 'formulas'}.
function doPasteSpecial(kind) {
  contextMenu.open = false
  if (!clipboard.hasData()) return
  const destSel = grid.getSelection()
  const sn = sheet.getCurrentSheet()
  const rects      = _pasteAffectedRects(destSel)
  const before     = Object.assign({}, ...rects.map(r => _captureRange(r, sn)))
  const beforeFmt  = Object.assign({}, ...rects.map(r => _captureFormatsRange(r, sn)))
  const beforeVal  = Object.assign({}, ...rects.map(r => _captureValidationRange(r, sn)))
  const cfBefore   = condFormat?.getRules?.(sn)?.length ?? 0
  if (clipboard.paste(activeCell.value, () => {}, kind, destSel)?.blocked) {
    _flashProtected(sn); return   // keep the pending cut/copy + its marching ants
  }
  for (const r of rects) _refreshDisplayForRange(r, sn)
  formulaValue.value = sheet.getCell(activeCell.value)   // fx bar tracks the pasted anchor
  clipboardHas.value = clipboard.hasData()
  grid?.setMarchingAnts(null)
  const after    = Object.assign({}, ...rects.map(r => _captureRange(r, sn)))
  const afterFmt = Object.assign({}, ...rects.map(r => _captureFormatsRange(r, sn)))
  const afterVal = Object.assign({}, ...rects.map(r => _captureValidationRange(r, sn)))
  const cfAfter  = condFormat?.getRules?.(sn)?.length ?? 0
  const refs     = _diffRefs(before, after)
  if (refs.length || cfBefore !== cfAfter) {
    _queueOp({ opType: 'paste', subSheet: sn, cellRefs: refs,
               before, after,
               summary: `Pasted ${kind} into ${refs.length} cell${refs.length === 1 ? '' : 's'}` })
    _pushPasteHistory({
      opType: 'paste', subSheet: sn, cellRefs: refs,
      before, after,
      beforeFormats: beforeFmt, afterFormats: afterFmt,
      beforeValidation: beforeVal, afterValidation: afterVal,
      cfChanged: cfBefore !== cfAfter,
    })
    syncFlags()
  }
  isDirty.value = true
  // Pivot recompute is handled centrally: the paste routed through
  // batchSetCells, whose onCellsChanged callback recomputes affected pivots.
}

// Push the right history entry for a paste. Cell + format + validation
// diffs round-trip through op-based undo (~10 µs); cond-format rule
// additions aren't tracked in the op shape, so when the rule list
// changed we fall back to a full engine snapshot for correctness.
function _pushPasteHistory(op) {
  if (op.cfChanged) { history.push(); return }
  history.pushOp(op)
}

// Re-push display strings for every cell in `rect`. Used after paste
// since format changes that happen AFTER batchSetCells don't fire the
// engine's onCellsChanged callback — the canvas has the right value
// but the wrong format-applied display.
function _refreshDisplayForRange(rect, sheetName) {
  if (!rect || !grid) return
  const sn = sheetName || sheet.getCurrentSheet()
  for (let r = rect.r0; r <= rect.r1; r++) {
    for (let c = rect.c0; c <= rect.c1; c++) {
      const id  = cellId(r, c)
      const fmt = formats.get(id, sn)
      const dv  = sheet.getDisplayValue(id, sn)
      grid.setCell(id, fmt.numberFormat ? applyNumberFmt(dv, fmt.numberFormat) : dv)
    }
  }
}

// ── History ───────────────────────────────────────────────────────────────────

// Re-mirror the canvas view state into the Vue refs that drive context-menu
// predicates (freezeRows > 0, manualHiddenRows.size > 0, ...). Called every
// time a snapshot lands — load, undo, redo — so the UI catches up with the
// grid's restored state.
function _syncViewMirrors() {
  const v = grid?.viewSnapshot?.()
  if (!v) return
  freezeRows.value = v.freezeRows || 0
  freezeCols.value = v.freezeCols || 0
  manualHiddenRows.clear(); for (const r of (v.hiddenRows || [])) manualHiddenRows.add(r)
  manualHiddenCols.clear(); for (const c of (v.hiddenCols || [])) manualHiddenCols.add(c)
}

function _afterHistoryNavigate() {
  _repopulateGrid()
  _applyHiddenRows()        // filter state restored → re-apply to grid
  _syncViewMirrors()
  syncNames()
  // The comment panel holds a reference into the (now-replaced) engine thread —
  // close it so a stale index can't delete the wrong reply after undo/redo.
  commentPanel.open = false
  activeCell.value   = 'A1'
  formulaValue.value = sheet.getCell('A1')
  refreshActiveFormat(); _syncNumberFormat('A1'); syncFlags()
  grid?.setMarchingAnts(null); clipboard.clear(); clipboardHas.value = false
}

function undo() {
  if (!history.undo()) return
  _afterHistoryNavigate()
}
function redo() {
  if (!history.redo()) return
  _afterHistoryNavigate()
}


// ── Number format ─────────────────────────────────────────────────────────────

function _syncNumberFormat(id) {
  const fmt = formats.get(id, sheet.getCurrentSheet())
  activeNumberFormat.value = fmt.numberFormat || ''
}

function toggleNumberFmt(type) {
  onNumberFormatChange(activeNumberFormatType.value === type ? '' : type)
}

// ── Format painter ────────────────────────────────────────────────────────────

let _copiedFormat = null

function toggleFormatPainter() {
  if (isPaintingFormat.value) {
    isPaintingFormat.value = false
    _copiedFormat = null
    return
  }
  const srcId = activeCell.value
  _copiedFormat = { ...formats.get(srcId, sheet.getCurrentSheet()) }
  isPaintingFormat.value = true
}

function _applyPaintedFormat() {
  if (!isPaintingFormat.value || !_copiedFormat) return
  _recordScopedFormatOp(_patchFmtOps(_copiedFormat))
  syncFlags()
  isDirty.value = true
  isPaintingFormat.value = false
  _copiedFormat = null
  refreshActiveFormat()
}

function onNumberFormatChange(value) {
  const sn  = sheet.getCurrentSheet()
  const ids = selectionIds()
  _recordFormatOp(ids, sn, () => formats.applyToRange(ids, { numberFormat: value }, sn))
  for (const id of ids) {
    const raw = sheet.getDisplayValue(id)
    grid?.setCell(id, value ? applyNumberFmt(raw, value) : raw)
  }
  _syncNumberFormat(activeCell.value)
  syncFlags()
  isDirty.value = true
}

// ── Comments ──────────────────────────────────────────────────────────────────

function openCommentPanel() {
  if (!grid) return
  const id   = activeCell.value
  const p    = parseCellId(id)
  const cv   = canvasRef.value?.getBoundingClientRect()
  // Cell rect is canvas-local CSS coords (zoom already applied). The panel
  // is position:fixed so we add the canvas's viewport offset. Prefer placing
  // it just to the right of the cell so the cell stays visible while typing;
  // flip left/up if it would overflow the viewport.
  const cell = p && grid.getCellRect ? grid.getCellRect(p.row, p.col) : null
  const PANEL_W = 260, PANEL_H = 200, GAP = 6
  let x, y
  if (cv && cell) {
    x = cv.left + cell.x + cell.width + GAP
    y = cv.top  + cell.y
    if (x + PANEL_W > window.innerWidth)  x = cv.left + cell.x - PANEL_W - GAP
    if (x < 4) x = 4
    if (y + PANEL_H > window.innerHeight) y = Math.max(4, window.innerHeight - PANEL_H - 4)
  } else {
    const rect = cv || { left: 100, top: 100 }
    x = rect.left + 60
    y = rect.top  + 40
  }
  commentPanel.id = id
  commentPanel.x  = x
  commentPanel.y  = y
  commentPanel.draft = ''
  _loadCommentThread()
  commentPanel.open = true
}

// Mirror the engine's thread for `commentPanel.id` into the reactive panel.
function _loadCommentThread() {
  const t = comments.getThread(commentPanel.id, sheet.getCurrentSheet())
  commentPanel.thread   = t ? t.thread : []
  commentPanel.resolved = t ? t.resolved : false
}

// Shared post-mutation: repaint, record for undo (comments ride the snapshot),
// and flag dirty so autosave persists the change.
function _afterCommentChange() {
  _loadCommentThread()
  notesPanel.rev++
  grid?.render()
  history.push()
  isDirty.value = true
}

function addCommentReply() {
  const text = commentPanel.draft.trim()
  if (!text) return
  comments.addReply(commentPanel.id, {
    author: userEmail.value,
    name:   userFullName.value || userEmail.value,
    text,
  }, sheet.getCurrentSheet())
  commentPanel.draft = ''
  _afterCommentChange()
}

function toggleResolveComment() {
  comments.resolve(commentPanel.id, !commentPanel.resolved, sheet.getCurrentSheet())
  _afterCommentChange()
}

function deleteCommentReply(i) {
  comments.removeReply(commentPanel.id, i, sheet.getCurrentSheet())
  _afterCommentChange()
  if (!commentPanel.thread.length) commentPanel.open = false
}

function deleteComment() {
  comments.clear(commentPanel.id, sheet.getCurrentSheet())
  commentPanel.open = false
  notesPanel.rev++
  grid?.render()
  history.push()
  isDirty.value = true
}

// "5m ago" style relative time for a reply's epoch-ms timestamp.
function commentTime(ts) {
  if (!ts) return ''
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (s < 60)    return 'just now'
  const m = Math.round(s / 60);   if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60);   if (h < 24) return `${h}h ago`
  return new Date(ts).toLocaleDateString()
}

// ── Notes side panel ──────────────────────────────────────────────────────────

// All notes across all sheets, ordered: current sheet first, then by row/col.
// Re-runs when notesPanel.rev bumps (after save/delete) — the comments engine
// itself isn't reactive.
const allNotes = computed(() => {
  notesPanel.rev   // dep for re-run
  const cur  = sheet.getCurrentSheet()
  const list = []
  for (const name of sheetNames.value) {
    const map = comments.getAll(name) || {}
    const entries = Object.keys(map)
      .map(id => ({ id, p: parseCellId(id) }))
      .filter(e => e.p)
      .sort((a, b) => a.p.row - b.p.row || a.p.col - b.p.col)
      .map(e => ({ sheet: name, id: e.id, text: comments.preview(e.id, name), resolved: !!comments.getThread(e.id, name)?.resolved }))
    list.push(...entries)
  }
  list.sort((a, b) => {
    if (a.sheet === cur && b.sheet !== cur) return -1
    if (b.sheet === cur && a.sheet !== cur) return 1
    return a.sheet.localeCompare(b.sheet)
  })
  return list
})

const notesGrouped = computed(() => {
  const out = []
  let cur = null
  for (const n of allNotes.value) {
    if (!cur || cur.sheet !== n.sheet) {
      cur = { sheet: n.sheet, items: [] }
      out.push(cur)
    }
    cur.items.push(n)
  }
  return out
})

function toggleNotesPanel() {
  if (notesPanel.open) { notesPanel.open = false; return }
  // Notes and version history dock the same right edge — keep one open at a time.
  if (vhOpen.value) closeVersionHistory()
  notesPanel.rev++  // force-refresh on open
  notesPanel.open = true
}

function jumpToNote(n) {
  if (!grid) return
  const p = parseCellId(n.id)
  if (!p) return
  if (n.sheet !== sheet.getCurrentSheet()) switchSheet(n.sheet)
  nextTick(() => {
    grid.moveTo(p.row, p.col)
    activeCell.value = n.id
    openCommentPanel()
  })
}

function addNoteFromPanel() {
  // Convenience: same as topbar note button, but invoked from inside the panel.
  openCommentPanel()
}

// ── Data validation ───────────────────────────────────────────────────────────

function openValidationDialog() {
  const e = validation.get(activeCell.value, sheet.getCurrentSheet())
  validationDialog.type     = e?.type     || 'list'
  validationDialog.operator = e?.operator || 'between'
  validationDialog.val1     = String(e?.min ?? '')
  validationDialog.val2     = String(e?.max ?? '')
  const opts   = e?.options || []
  const colors = e?.colors  || {}
  validationDialog.listItems = opts.length
    ? opts.map(o => ({ label: o, color: colors[o] || '' }))
    : [{ label: '', color: '' }]   // start with one empty row to type into
  validationDialog.message  = e?.message  || ''
  validationDialog.severity = e?.severity || 'reject'
  validationDialog.open     = true
}

// The auto (unset) chip colour for the item at position `i` — matches how the
// painter slots colours by option order, so the dialog previews the real thing.
function autoChipColor(i) { return chipPaletteColor(i) }

function addListItem(afterIdx) {
  const row = { label: '', color: '' }
  if (afterIdx == null) validationDialog.listItems.push(row)
  else validationDialog.listItems.splice(afterIdx + 1, 0, row)
  focusListItem(afterIdx == null ? validationDialog.listItems.length - 1 : afterIdx + 1)
}

function removeListItem(i) {
  validationDialog.listItems.splice(i, 1)
  if (!validationDialog.listItems.length) validationDialog.listItems.push({ label: '', color: '' })
}

// Paste a comma/newline-separated list into a row → split it across rows, so
// bulk entry ("Yes, No, Maybe") still works alongside per-item editing.
function onListPaste(ev, i) {
  const text = ev.clipboardData?.getData('text') || ''
  if (!/[,\n]/.test(text)) return   // single value → let the default paste happen
  ev.preventDefault()
  const parts = text.split(/[,\n]/).map(s => s.trim()).filter(Boolean)
  if (!parts.length) return
  validationDialog.listItems[i].label = parts[0]
  validationDialog.listItems.splice(i + 1, 0, ...parts.slice(1).map(label => ({ label, color: '' })))
}

async function focusListItem(i) {
  await nextTick()
  vdListEl.value?.querySelectorAll('.sn-vd-item-input')?.[i]?.focus()
}

function confirmValidation() {
  const ids = selectionIds()
  const sn  = sheet.getCurrentSheet()
  const msg = validationDialog.message.trim() || undefined
  // 'warn' only differs from the default when the value fails, and a checkbox
  // is TRUE/FALSE-only where "allow anyway" makes no sense — so scope it out.
  const severity = validationDialog.type === 'checkbox' ? undefined
    : (validationDialog.severity === 'warn' ? 'warn' : undefined)
  let rule
  if (validationDialog.type === 'checkbox') {
    rule = { type: 'checkbox', message: msg }
  } else if (validationDialog.type === 'list') {
    // De-dupe by label (first wins), keeping only rows that have a colour set.
    const options = []
    const colors  = {}
    for (const it of validationDialog.listItems) {
      const label = it.label.trim()
      if (!label || options.includes(label)) continue
      options.push(label)
      if (it.color) colors[label] = it.color
    }
    rule = { type: 'list', options, message: msg, severity }
    if (Object.keys(colors).length) rule.colors = colors
  } else {
    const op  = validationDialog.operator
    const v1  = parseFloat(validationDialog.val1)
    const v2  = parseFloat(validationDialog.val2)
    const min = isNaN(v1) ? undefined : v1
    const max = ['between', 'not_between'].includes(op) && !isNaN(v2) ? v2 : undefined
    rule = { type: validationDialog.type, operator: op, min, max, message: msg, severity }
  }
  for (const id of ids) validation.set(id, rule, sn)

  // Checkbox cells need a concrete value to render as unchecked and to feed
  // formulas (SUM / COUNTIF) right away — fill blanks with FALSE, à la Sheets.
  // The rule + these values ride in the single history.push() snapshot below,
  // so one undo reverts the whole "apply checkboxes" action.
  if (validationDialog.type === 'checkbox') {
    const filled = []
    for (const id of ids) {
      const cur = sheet.getCell(id, sn)
      if (cur == null || String(cur) === '') {
        sheet.setCell(id, 'FALSE', sn)
        filled.push({ id, value: 'FALSE' })
      }
    }
    if (filled.length) {
      broadcastBatchChange(sn, filled)
      recomputePivotsForSheet(sn)
    }
  }

  validationDialog.open = false
  grid?.render()
  history.push()   // rule + any FALSE-fill live in the snapshot; record for undo
  isDirty.value = true
}

function removeValidation() {
  const ids = selectionIds()
  const sn  = sheet.getCurrentSheet()
  for (const id of ids) validation.clear(id, sn)
  validationDialog.open = false
  grid?.render()
  history.push()
  isDirty.value = true
}

function openDropdown(id, rule, pos = {}) {
  if (rule?.type !== 'list') return
  dropdownPanel.id      = id
  dropdownPanel.options = rule.options
  dropdownPanel.rule    = rule
  dropdownPanel.value   = String(sheet.getCell(id, sheet.getCurrentSheet()) ?? '')
  dropdownPanel.x       = pos.x ?? 0
  dropdownPanel.y       = pos.y ?? 0
  dropdownPanel.w       = pos.w ?? 120
  dropdownPanel.open    = true
}

function pickDropdownOption(opt) {
  const id     = dropdownPanel.id
  const sn     = sheet.getCurrentSheet()
  if (_cellBlocked(id, sn)) { dropdownPanel.open = false; return }
  const before = { [id]: sheet.getCell(id, sn) }
  sheet.setCell(id, opt)
  dropdownPanel.open = false
  _pushEditOp(sn, before, 'Edit cell')
  recomputePivotsForSheet(sn)
}

// Clicking a checkbox cell's tickbox flips TRUE ↔ FALSE (empty → TRUE). Routed
// through the same edit-op path as a dropdown pick so undo + collab match.
function toggleCheckbox(id) {
  const sn     = sheet.getCurrentSheet()
  const before = { [id]: sheet.getCell(id, sn) }
  const next   = String(before[id]).toUpperCase() === 'TRUE' ? 'FALSE' : 'TRUE'
  sheet.setCell(id, next, sn)
  _pushEditOp(sn, before, 'Toggle checkbox')
  recomputePivotsForSheet(sn)
}

// ── Conditional formatting ────────────────────────────────────────────────────

const CF_COND_OPTIONS = [
  { label: 'Greater than',     value: 'gt'          },
  { label: 'Less than',        value: 'lt'          },
  { label: 'Greater or equal', value: 'gte'         },
  { label: 'Less or equal',    value: 'lte'         },
  { label: 'Equal to',         value: 'eq'          },
  { label: 'Not equal to',     value: 'neq'         },
  { label: 'Between',          value: 'between'     },
  { label: 'Contains',         value: 'contains'    },
  { label: 'Does not contain', value: 'notcontains' },
  { label: 'Is empty',         value: 'empty'       },
  { label: 'Is not empty',     value: 'notempty'    },
]

const CF_KIND_OPTIONS = [
  { label: 'Single colour rule', value: 'classic'     },
  { label: 'Colour scale',       value: 'color-scale' },
  { label: 'Data bars',          value: 'data-bar'    },
  { label: 'Icon set',           value: 'icon-set'    },
]

const CF_SCALE_VARIANT_OPTIONS = [
  { label: '2-colour (low → high)',         value: '2color' },
  { label: '3-colour (low → mid → high)',   value: '3color' },
]

const CF_ICON_SET_OPTIONS = [
  { label: 'Arrows (red/grey/green)',  value: 'arrows3'  },
  { label: 'Traffic lights',           value: 'traffic3' },
  { label: 'Circles (empty → full)',   value: 'circles3' },
]

const cfRangeLabel = computed(() => {
  const { r0, c0, r1, c1 } = cfDialog.range
  return `${colLabel(c0)}${r0 + 1}:${colLabel(c1)}${r1 + 1}`
})

// `<input type="color">` rejects anything that isn't a literal #rrggbb.
// Old rules may have been saved with CSS-var values back when the dialog
// defaulted to `var(--surface-red-1)`; coerce those to '' so the input
// falls back to its default rather than throwing a DOMException.
function _coerceHex(v) {
  if (typeof v !== 'string') return ''
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v : ''
}

function openCfDialog(existingId) {
  const sel = grid?.getSelection() || { r0: 0, c0: 0, r1: 0, c1: 0 }
  cfDialog.range      = { ...sel }
  cfDialog.editId     = existingId
  cfDialog.kind       = 'classic'
  cfDialog.condType   = 'gt'
  cfDialog.condValue  = ''
  cfDialog.condValue2 = ''
  cfDialog.fmtColor   = ''
  // `<input type="color">` rejects CSS-var values — it requires a literal
  // #rrggbb. Use the resolved hex for --surface-red-1 instead.
  cfDialog.fmtBg      = '#FEE2E2'
  cfDialog.scaleVariant = '2color'
  cfDialog.scaleMin   = '#FFFFFF'
  cfDialog.scaleMid   = '#FFEB3B'
  cfDialog.scaleMax   = '#0E7490'
  cfDialog.barColor   = '#0E7490'
  cfDialog.iconSet    = 'arrows3'

  // If we're editing an existing rule, hydrate the dialog state from it so
  // the user sees their previous selections instead of the blank defaults.
  if (existingId !== null) {
    const existing = condFormat.getRules(sheet.getCurrentSheet()).find(r => r.id === existingId)
    if (existing) {
      cfDialog.range = { ...existing.range }
      cfDialog.kind  = existing.kind || 'classic'
      if (existing.kind === 'color-scale') {
        cfDialog.scaleVariant = existing.scale?.variant || '2color'
        cfDialog.scaleMin     = existing.scale?.minColor || cfDialog.scaleMin
        cfDialog.scaleMid     = existing.scale?.midColor || cfDialog.scaleMid
        cfDialog.scaleMax     = existing.scale?.maxColor || cfDialog.scaleMax
      } else if (existing.kind === 'data-bar') {
        cfDialog.barColor = existing.bar?.color || cfDialog.barColor
      } else if (existing.kind === 'icon-set') {
        cfDialog.iconSet = existing.icons?.set || cfDialog.iconSet
      } else {
        cfDialog.condType   = existing.condition?.type   || 'gt'
        cfDialog.condValue  = existing.condition?.value  ?? ''
        cfDialog.condValue2 = existing.condition?.value2 ?? ''
        cfDialog.fmtColor   = _coerceHex(existing.format?.color)           || ''
        cfDialog.fmtBg      = _coerceHex(existing.format?.backgroundColor) || cfDialog.fmtBg
      }
    }
  }
  cfDialog.open = true
}

function _buildCfRule() {
  const range = { ...cfDialog.range }
  if (cfDialog.kind === 'color-scale') {
    const scale = cfDialog.scaleVariant === '3color'
      ? { variant: '3color', minColor: cfDialog.scaleMin, midColor: cfDialog.scaleMid, maxColor: cfDialog.scaleMax, midPercent: 0.5 }
      : { variant: '2color', minColor: cfDialog.scaleMin, maxColor: cfDialog.scaleMax }
    return { range, kind: 'color-scale', scale }
  }
  if (cfDialog.kind === 'data-bar') {
    return { range, kind: 'data-bar', bar: { color: cfDialog.barColor } }
  }
  if (cfDialog.kind === 'icon-set') {
    return { range, kind: 'icon-set', icons: { set: cfDialog.iconSet, thresholds: [0.33, 0.66] } }
  }
  // Classic single-colour rule.
  return {
    range,
    condition: { type: cfDialog.condType, value: cfDialog.condValue, value2: cfDialog.condValue2 },
    format: {
      ...(cfDialog.fmtColor ? { color: cfDialog.fmtColor } : {}),
      ...(cfDialog.fmtBg && cfDialog.fmtBg !== '#ffffff' ? { backgroundColor: cfDialog.fmtBg } : {}),
    },
  }
}

function saveCfRule() {
  const sn = sheet.getCurrentSheet()
  const rule = _buildCfRule()
  history.push()
  if (cfDialog.editId !== null) condFormat.updateRule(cfDialog.editId, rule, sn)
  else condFormat.addRule(rule, sn)
  history.push()
  syncFlags()
  cfDialog.open = false
  grid?.render()
  isDirty.value = true
}

function deleteCfRule() {
  history.push()
  condFormat.removeRule(cfDialog.editId, sheet.getCurrentSheet())
  history.push()
  syncFlags()
  cfDialog.open = false
  grid?.render()
  isDirty.value = true
}

// Inline delete from the "existing rules" list — no need to open the dialog
// in edit mode first. Same history bracketing as deleteCfRule.
function deleteCfRuleById(id) {
  history.push()
  condFormat.removeRule(id, sheet.getCurrentSheet())
  history.push()
  syncFlags()
  grid?.render()
  isDirty.value = true
}

// Pretty label for the rule list. Mirrors CF_KIND_OPTIONS / CF_COND_OPTIONS.
function cfRuleLabel(rule) {
  const r = rule.range
  const range = `${colLabel(r.c0)}${r.r0 + 1}:${colLabel(r.c1)}${r.r1 + 1}`
  if (rule.kind === 'color-scale') return `${range} · Colour scale`
  if (rule.kind === 'data-bar')    return `${range} · Data bars`
  if (rule.kind === 'icon-set')    return `${range} · Icon set`
  const t = rule.condition?.type
  const v = rule.condition?.value
  const summary = t === 'between' ? `between ${v} and ${rule.condition?.value2}`
                : t === 'empty' || t === 'notempty' ? t
                : `${t} ${v}`
  return `${range} · ${summary}`
}

// Existing rules for the active sheet — exposed to the dialog template.
const cfRulesForSheet = computed(() => {
  // Touch renderVersion so the list re-evaluates when rules are mutated.
  renderVersion.value
  return condFormat.getRules(sheet.getCurrentSheet())
})



// ── Cell edit history ─────────────────────────────────────────────────────────

async function openCellHistory() {
  contextMenu.open = false
  if (props.id === 'new') return
  const id = activeCell.value
  cellHistory.cell    = id
  cellHistory.open    = true
  cellHistory.loading = true
  cellHistory.error   = ''
  cellHistory.entries = []
  try {
    cellHistory.entries = await versionsApi.cellHistory(
      props.id, id, sheet.getCurrentSheet(),
    )
  } catch (err) {
    cellHistory.error = err.message || 'Failed to load cell history'
  } finally {
    cellHistory.loading = false
  }
}


// ── Find & Replace ────────────────────────────────────────────────────────────

function onNavigateTo(id) {
  if (!grid) return
  const p = parseCellId(id)
  if (!p) return
  grid.moveTo(p.row, p.col)
}

// ── Sort & Filter ─────────────────────────────────────────────────────────────

// Expand a single anchor cell to the contiguous non-empty data block around it
// (Google-Sheets Ctrl+A behaviour). If the anchor itself is empty, pivot to
// the adjacent cell down/right that has data — the empty anchor then becomes
// the header row/col of the resulting block. Returns null only when nothing
// adjacent has data either.
function _detectContiguousBlock(r, c) {
  const hasVal = (rr, cc) =>
    rr >= 0 && cc >= 0 && String(sheet.getCell(cellId(rr, cc)) ?? '').length > 0
  const anchorEmpty = !hasVal(r, c)
  let ar = r, ac = c
  if (anchorEmpty) {
    if      (hasVal(r + 1, c)) ar = r + 1
    else if (hasVal(r, c + 1)) ac = c + 1
    else return null
  }
  let r0 = ar, r1 = ar, c0 = ac, c1 = ac
  while (r0 > 0 && hasVal(r0 - 1, ac)) r0--
  while (hasVal(r1 + 1, ac))           r1++
  while (c0 > 0 && hasVal(ar, c0 - 1)) c0--
  while (hasVal(ar, c1 + 1))           c1++
  // Walk again from the new top-row left/right edges in case the block widens
  // below; this matches Google Sheets' "smart" expansion well enough for now.
  for (let rr = r0; rr <= r1; rr++) {
    while (c0 > 0 && hasVal(rr, c0 - 1)) c0--
    while (hasVal(rr, c1 + 1))           c1++
  }
  // If the original anchor sits exactly one row above (or one col left of)
  // the detected block, fold it in as the header row/col.
  if (anchorEmpty && r === r0 - 1 && c >= c0 && c <= c1) r0 = r
  if (anchorEmpty && c === c0 - 1 && r >= r0 && r <= r1) c0 = c
  return { r0, c0, r1, c1 }
}

// Create a filter on the user's current selection.  A selection that spans no
// data rows — a single cell, or a lone header row like A1:E1 — auto-expands to
// the contiguous data block around its top-left anchor (or refuses if that
// anchor is empty). Without this, toggling the filter on just the header row
// would produce a header-only range (r1 === r0): chevrons appear, but the
// value list scans zero data rows and comes up empty. A genuine multi-row
// block is taken verbatim.
function _createFilterOnSelection() {
  if (!grid) return
  const sel = grid.getSelection()
  const noDataRows = sel.r0 === sel.r1
  const range = noDataRows
    ? (_detectContiguousBlock(sel.r0, sel.c0) || { r0: sel.r0, c0: sel.c0, r1: sel.r0, c1: sel.c0 })
    : { r0: sel.r0, c0: sel.c0, r1: sel.r1, c1: sel.c1 }
  sortFilter.setRange(range, sheet.getCurrentSheet())
  filterPanel.open = false
  _applyHiddenRows()
  grid?.render?.()
  history.push()
  isDirty.value = true
}

function _removeFilter() {
  sortFilter.clearRange(sheet.getCurrentSheet())
  filterPanel.open = false
  _applyHiddenRows()
  grid?.render?.()
  history.push()
  isDirty.value = true
}

// ── Slicers ────────────────────────────────────────────────────────────────
// A slicer is a floating value-filter control bound to a column of the filter
// range. It reads/writes that column's `inSet` spec in sortFilter; the slicers
// engine only tracks the column + float position. `slicerVersion` is bumped on
// every slicer/filter change so the panels re-derive their checklists.
const slicerVersion = ref(0)
let _slicerDrag = null

// One reactive snapshot per slicer: the column picker's options, the value list
// with PLAIN boolean checked flags, and whether a filter is active — all derived
// together on each slicerVersion bump. The template binds to these plain values
// (not to function calls over the non-reactive sortFilter engine), so the panel
// can never drift out of sync with the applied filter.
const activeSlicers = computed(() => {
  slicerVersion.value
  const sn      = currentSheet.value
  const range   = sortFilter.getRange(sn)
  const options = range ? _slicerColumnOptions(range, sn) : []
  return slicers.list(sn).map(sl => {
    const values = sortFilter.getColumnValues(sl.col, sn)
    const spec   = sortFilter.getFilterConfig(sn)[sl.col]
    const set    = spec?.operator === 'inSet' ? new Set(spec.values) : null   // null → unfiltered
    return {
      id: sl.id, col: sl.col, x: sl.x, y: sl.y,
      label: slicerLabel(sl, sn),
      options,
      rows: values.map(v => ({ v, checked: !set || set.has(v) })),
    }
  })
})

// Every column of the filter range, as { label: header, value: colIdx } — the
// raw list the header dropdown is built from.
function _slicerColumnOptions(range, sn) {
  const opts = []
  for (let c = range.c0; c <= range.c1; c++) {
    const header = sheet.getDisplayValue(colLabel(c) + (range.r0 + 1), sn)
    opts.push({ label: header || colLabel(c), value: c })
  }
  return opts
}
// frappe-ui Dropdown options for a slicer's column picker — a styled, teleported
// popover (not a native <select>, which overflowed the floating panel). The
// current column is marked so the menu reads like a real selector.
function slicerColMenu(sl) {
  return sl.options.map(o => ({
    label: o.label,
    icon: o.value === sl.col ? 'check' : null,
    onClick: () => changeSlicerColumn(sl, o.value),
  }))
}

function slicerValues(sl) { return sortFilter.getColumnValues(sl.col, sheet.getCurrentSheet()) }
function slicerLabel(sl, sn = sheet.getCurrentSheet()) {
  const range = sortFilter.getRange(sn)
  const header = range ? sheet.getDisplayValue(colLabel(sl.col) + (range.r0 + 1), sn) : ''
  return header || colLabel(sl.col)
}
// The set of values currently kept visible, or null when the column is unfiltered.
function _slicerCheckedSet(sl) {
  const spec = sortFilter.getFilterConfig(sheet.getCurrentSheet())[sl.col]
  return spec?.operator === 'inSet' ? new Set(spec.values) : null
}
function toggleSlicerValue(sl, v) {
  const all = slicerValues(sl)
  const set = _slicerCheckedSet(sl) || new Set(all)
  set.has(v) ? set.delete(v) : set.add(v)
  _applySlicerFilter(sl, set, all)
}
// "Select all" always shows everything — it clears the column's filter outright
// rather than toggling, so it can never surprise-hide the data.
function selectAllSlicer(sl) {
  const sn = sheet.getCurrentSheet()
  sortFilter.clearFilter(sl.col, sn)
  _repopulateGrid(); _applyHiddenRows(); history.push(); isDirty.value = true
}
// "Clear" empties the selection (an inSet with no values) so the user can then
// pick just the values they want — the Google-Sheets filter idiom.
function clearSlicerValues(sl) {
  const sn = sheet.getCurrentSheet()
  sortFilter.setFilter(sl.col, { operator: 'inSet', values: [] }, sn)
  _repopulateGrid(); _applyHiddenRows(); history.push(); isDirty.value = true
}
// Re-point a slicer at a different column of the filter range; the old column's
// filter is released so it stops hiding rows with no visible control.
function changeSlicerColumn(sl, value) {
  const sn     = sheet.getCurrentSheet()
  const newCol = Number(value)
  if (Number.isNaN(newCol) || newCol === sl.col) return
  // Bail before touching anything if another slicer already owns the target —
  // otherwise we'd clear this column's filter for a move that can't happen.
  if (slicers.list(sn).some(s => s.col === newCol && s.id !== sl.id)) return
  sortFilter.clearFilter(sl.col, sn)
  slicers.setCol(sl.id, newCol, sn)
  _repopulateGrid(); _applyHiddenRows(); history.push(); isDirty.value = true
}
function _applySlicerFilter(sl, set, all) {
  const sn = sheet.getCurrentSheet()
  // All-checked is identical to no filter — clear the column instead of storing
  // every value (mirrors applyFilter).
  if (set.size === all.length) sortFilter.clearFilter(sl.col, sn)
  else                         sortFilter.setFilter(sl.col, { operator: 'inSet', values: [...set] }, sn)
  _repopulateGrid()
  _applyHiddenRows()
  history.push()
  isDirty.value = true
  slicerVersion.value++
}
function insertSlicer() {
  contextMenu.open = false
  const sn  = sheet.getCurrentSheet()
  const p   = parseCellId(activeCell.value)
  const col = p ? p.col : 0
  if (slicers.list(sn).some(s => s.col === col)) return   // column already has a slicer
  // A slicer reads distinct values from the filter range — auto-create one over
  // the surrounding data block if the sheet isn't filtered yet.
  if (!sortFilter.getRange(sn)) {
    const block = _detectContiguousBlock(p?.row ?? 0, col)
    if (!block) return   // no data to slice
    sortFilter.setRange(block, sn)
  }
  // A slicer filters one column OF the filter range. A column outside it has no
  // values to show and can't appear in the column picker — refuse rather than
  // strand a dead slicer. (Auto-created ranges are centred on col, so they pass.)
  const range = sortFilter.getRange(sn)
  if (!range || col < range.c0 || col > range.c1) return
  slicers.add(col, 96 + slicers.list(sn).length * 28, 96, sn)
  _applyHiddenRows()      // paints the filter's chevrons/outline (and bumps slicerVersion)
  grid?.render?.()
  history.push()
  isDirty.value = true
}
function removeSlicer(sl) {
  const sn = sheet.getCurrentSheet()
  slicers.remove(sl.id, sn)
  // The slicer IS the filter control for its column — clear the filter it
  // applied so removing it doesn't strand hidden rows with no visible control.
  sortFilter.clearFilter(sl.col, sn)
  _repopulateGrid()
  _applyHiddenRows()      // un-hides the rows + bumps slicerVersion
  history.push()
  isDirty.value = true
}
function startSlicerDrag(sl, e) {
  _slicerDrag = { id: sl.id, sx: e.clientX, sy: e.clientY, ox: sl.x, oy: sl.y }
  window.addEventListener('mousemove', _onSlicerDrag)
  window.addEventListener('mouseup', _endSlicerDrag)
}
function _onSlicerDrag(e) {
  if (!_slicerDrag) return
  const { id, sx, sy, ox, oy } = _slicerDrag
  slicers.move(id, Math.max(0, ox + e.clientX - sx), Math.max(0, oy + e.clientY - sy), sheet.getCurrentSheet())
  slicerVersion.value++
}
function _endSlicerDrag() {
  if (_slicerDrag) { history.push(); isDirty.value = true }
  _slicerDrag = null
  window.removeEventListener('mousemove', _onSlicerDrag)
  window.removeEventListener('mouseup', _endSlicerDrag)
}

function openFilterPanel(colIdx) {
  const sn  = sheet.getCurrentSheet()
  const cfg = sortFilter.getFilterConfig(sn)
  const existing = cfg[colIdx]
  const allValues = sortFilter.getColumnValues(colIdx, sn)
  filterPanel.col       = colIdx
  filterPanel.allValues = allValues
  filterPanel.valueSearch = ''
  // Decide initial mode + state from the existing spec (if any). `inSet`
  // → values mode with the saved selection; condition-style ops → condition
  // mode; nothing saved → default values mode with every value checked.
  if (existing?.operator === 'inSet') {
    filterPanel.mode      = 'values'
    filterPanel.operator  = 'contains'
    filterPanel.value     = ''
    filterPanel.valueSet  = new Set(existing.values || [])
  } else if (existing) {
    filterPanel.mode      = 'condition'
    filterPanel.operator  = existing.operator || 'contains'
    filterPanel.value     = existing.value    || ''
    filterPanel.valueSet  = new Set(allValues)
  } else {
    filterPanel.mode      = 'values'
    filterPanel.operator  = 'contains'
    filterPanel.value     = ''
    filterPanel.valueSet  = new Set(allValues)
  }
  filterPanel.open = true
}

// The panel renders at FILTER_PANEL_W px outer width (260 content + 24 padding +
// 2 border, content-box). clampFilterLeft keeps its full width inside the grid
// wrap so chevrons on right-edge columns don't push the Apply/Close buttons
// off-screen. Live positioning lives in the filterPanelStyle computed.
const FILTER_PANEL_W = 286
function clampFilterLeft(left, wrapWidth) {
  const GAP = 6
  const maxLeft = wrapWidth - FILTER_PANEL_W - GAP
  return Math.max(GAP, Math.min(left, maxLeft))
}

// Alt+↓ on a canvas cell opens the filter panel for that cell's column. Forces
// the filter row visible first (so chevrons exist) and anchors the popover at
// the column's row-0 cell rather than at a click target.
function openQuickFilterForActive() {
  const id = activeCell.value
  const p  = parseCellId(id)
  if (!p) return
  if (!sortFilter.hasFilter(sheet.getCurrentSheet())) _createFilterOnSelection()
  nextTick(() => {
    const range = sortFilter.getRange(sheet.getCurrentSheet())
    if (!range || p.col < range.c0 || p.col > range.c1) return
    const rects   = grid?.getColumnHeaderRects?.() || []
    const colRect = rects.find(r => r.c === p.col)
    const rowRect = grid?.getRowRect?.(range.r0)
    if (!colRect || !rowRect) return
    const cfg = sortFilter.getFilterConfig(sheet.getCurrentSheet())
    filterPanel.open     = true
    filterPanel.col      = p.col
    filterPanel.operator = cfg[p.col]?.operator || 'contains'
    filterPanel.value    = cfg[p.col]?.value    || ''
    // Position is derived live by the filterPanelStyle computed; we only need
    // the column visible here so the panel has a valid anchor on open.
  })
}

function applyFilter() {
  const sn = sheet.getCurrentSheet()
  if (filterPanel.mode === 'values') {
    // No-op safety: an all-checked selection is identical to no filter at
    // all, so clear the column entry instead of saving every value.
    if (filterPanel.valueSet.size === filterPanel.allValues.length) {
      sortFilter.clearFilter(filterPanel.col, sn)
    } else {
      sortFilter.setFilter(
        filterPanel.col,
        { operator: 'inSet', values: [...filterPanel.valueSet] },
        sn,
      )
    }
  } else {
    sortFilter.setFilter(
      filterPanel.col,
      { operator: filterPanel.operator, value: filterPanel.value },
      sn,
    )
  }
  filterPanel.open = false
  _repopulateGrid()
  _applyHiddenRows()
  history.push()
  isDirty.value = true
}

function clearFilterCol() {
  sortFilter.clearFilter(filterPanel.col, sheet.getCurrentSheet())
  filterPanel.open = false
  _repopulateGrid()
  _applyHiddenRows()
  history.push()
  isDirty.value = true
}

function doSort(colIdx, dir) {
  const sn = sheet.getCurrentSheet()
  // Sorting permutes values across the filter range — refuse if it overlaps
  // protection, matching Google Sheets (a protected range blocks the sort).
  const range = sortFilter.getRange(sn)
  if (range && _rectBlocked(range, sn)) return
  sortFilter.sort(colIdx, dir, sn)
  filterPanel.open = false
  _repopulateGrid()
  _applyHiddenRows()
  history.push()   // post-mutate snapshot
  syncFlags()
  isDirty.value = true   // sort mutates cell values
}

function doSortActive(dir) {
  const p = parseCellId(activeCell.value)
  doSort(p ? p.col : 0, dir)
}

// ── Context menu ──────────────────────────────────────────────────────────────

const showRenameDialog = ref(false)
const renameValue      = ref('')
const renameError      = ref('')
const renameInputRef   = ref(null)
let _renameTarget      = ''

function openRenameDialog(name) {
  // Reachable via dbl-click on the tab even when the menu is suppressed — gate
  // here so rename is denied for viewers regardless of entry point.
  if (readOnly.value) return
  tabMenu.open = false
  _renameTarget      = name
  renameValue.value  = name
  renameError.value  = ''
  showRenameDialog.value = true
  // Dialog mounts the input asynchronously — focus + select on the next two
  // ticks so the user can type immediately instead of clicking the field.
  nextTick(() => nextTick(() => {
    const el = renameInputRef.value?.$el?.querySelector?.('input')
            ?? renameInputRef.value?.input
            ?? renameInputRef.value
    if (el?.focus) { el.focus(); el.select?.() }
  }))
}

function confirmRename() {
  const oldName = _renameTarget
  const newName = renameValue.value
  const ok = _renameSheet(oldName, newName)
  if (!ok) {
    renameError.value = 'Name is empty or already used.'
    return
  }
  // Keep named-range bindings pointed at the renamed sheet — without this,
  // `=Revenue` defined on "Sheet1" breaks after renaming Sheet1.
  namedRanges.renameSheet(oldName, newName)
  showRenameDialog.value = false
  history.push()
  isDirty.value = true
}

function doDuplicateSheet(name) {
  tabMenu.open = false
  _duplicateSheet(name)
  history.push()
  isDirty.value = true
}

function doDeleteSheet(name) {
  tabMenu.open = false
  if (_deleteSheet(name)) { history.push(); isDirty.value = true }
}

function _onDocMouseDown(e) {
  // Close context menus only when clicking OUTSIDE them. Never close on
  // mousedown when clicking a button inside — that would remove the element
  // before its click event fires, making every menu item a no-op.
  const menus = document.querySelectorAll('.sn-ctx-menu, .sn-comment-panel, .sn-dropdown-panel, .sn-sp-pop')
  let inside = false
  for (const el of menus) if (el.contains(e.target)) { inside = true; break }
  if (!inside) {
    contextMenu.open = false
    tabMenu.open = false
    dropdownPanel.open = false
    // Split-text outside-click is treated as Cancel — preview is reverted
    // because the user never explicitly committed to the result.
    if (splitText.open) { _revertSplitPreview(); _closeSplit() }
  }
}


// Row twin of _applyColStructural — same reference-correct path for row ops.
// Slicers are column-bound only, so they take no row remap.
function _applyRowStructural(mapRow) {
  const sn = sheet.getCurrentSheet()
  sheet.remapRows(mapRow, sn)
  formats.remapRows(mapRow, sn)
  merge.remapRows(mapRow, sn)
  comments.remapRows(mapRow, sn)
  validation.remapRows(mapRow, sn)
  protection.remapRows(mapRow, sn)
  condFormat.remapRows(mapRow, sn)
  sortFilter.remapRows(mapRow, sn)
  namedRanges.remapRows(mapRow, sn)
  charts.remapRows(mapRow, sn)
  pivot.remapRows(mapRow, sn)
  grid.remapRowsMeta(mapRow)
  _repopulateGrid()
  _applyHiddenRows()
  markEdited()
  recomputePivotsForSheet(sn)
}

function doInsertRow(below = false, count = 1) {
  contextMenu.open = false
  const atRow = contextMenu.targetRow + (below ? 1 : 0)
  _applyRowStructural(insertMap(atRow, count))
}

// ── Zoom ──────────────────────────────────────────────────────────────────────
const zoomLevel = ref(1)
function zoomBy(delta) {
  const next = Math.round(((grid?.getZoom() ?? 1) + delta) * 10) / 10
  grid?.setZoom(next)
  zoomLevel.value = grid?.getZoom() ?? 1
}
function resetZoom() { grid?.setZoom(1); zoomLevel.value = 1 }

// ── Font size / family ────────────────────────────────────────────────────────
function setFontFamily(keyOrStack) {
  // Accept either a short key ('inter', 'mono', …) from the toolbar select or
  // a raw CSS font-family stack (used by F4 replay). Normalize to the stack.
  const stack = FONT_FAMILY_STACK[keyOrStack] || keyOrStack
  _recordScopedFormatOp(_patchFmtOps({ fontFamily: stack }))
  refreshActiveFormat()
  grid?.render()
  syncFlags()
  recordAction?.('setFontFamily', [stack])
  isDirty.value = true
}

// Mutation triple ({ cols, rows, cells }) that applies a visual format patch at
// whichever scope the selection implies.
function _patchFmtOps(patch) {
  return {
    cols:  (cols, sn) => formats.applyToColumns(cols, patch, sn),
    rows:  (rows, sn) => formats.applyToRows(rows, patch, sn),
    cells: (ids, sn)  => formats.applyToRange(ids, patch, sn),
  }
}

const _clampFont = v => Math.max(8, Math.min(72, v))

function adjustFontSize(delta) {
  _recordScopedFormatOp({
    cols:  (cols, sn) => { for (const c of cols) formats.setCol(c, { fontSize: _clampFont((formats.getCol(c, sn).fontSize || 13) + delta) }, sn) },
    rows:  (rows, sn) => { for (const r of rows) formats.setRow(r, { fontSize: _clampFont((formats.getRow(r, sn).fontSize || 13) + delta) }, sn) },
    cells: (ids, sn)  => { for (const id of ids) formats.applyToRange([id], { fontSize: _clampFont((formats.get(id, sn).fontSize || 13) + delta) }, sn) },
  })
  refreshActiveFormat()
  grid?.render()
  syncFlags()
  recordAction?.('adjustFontSize', [delta])
  isDirty.value = true
}

// Set font size on the selection directly to whatever the user typed. Clamped
// to [8, 72] to match adjustFontSize. Called from the toolbar's font-size
// input on commit (Enter / blur).
function setFontSize(px) {
  const n = _clampFont(parseInt(px, 10) || 13)
  _recordScopedFormatOp(_patchFmtOps({ fontSize: n }))
  refreshActiveFormat()
  grid?.render()
  syncFlags()
  recordAction?.('setFontSize', [n])
  isDirty.value = true
}

function onFontSizeInput(e) {
  setFontSize(e.target.value)
  // Snap the displayed value back to the clamped result.
  e.target.value = activeFormat.value.fontSize || 13
  e.target.blur()
}

// ── Hyperlink ─────────────────────────────────────────────────────────────────

// Google-Sheets URL auto-detection: after a typed edit commits, a whole-cell
// URL gets fmt.hyperlink set on it. Recorded as its OWN format op after the
// edit op, so the first Ctrl+Z strips just the link and the second undoes the
// text — matching Google's "undo removes the auto-link" behavior. The inverse
// also runs: editing an auto-linked cell (text === its URL) to a non-URL
// drops the stale link; custom display text set via Ctrl+L keeps it.

// The hyperlink patch a committed edit implies for one cell, or null.
function _autoLinkChange(id, value, before, sn) {
	const url  = detectHyperlink(String(value ?? ''))
	const prev = formats.getCellFormat(id, sn).hyperlink || null
	if (url) return prev === url ? null : { id, url }
	return prev && isAutoLinkText(before, prev) ? { id, url: null } : null
}

// cells: [{ id, value, before }] — single-cell commits and Ctrl+Enter batch
// commits share this; a batch records ONE format op so one undo strips all.
function _maybeAutoLink(cells, sn) {
	const changes = cells.map(c => _autoLinkChange(c.id, c.value, c.before, sn)).filter(Boolean)
	if (!changes.length) return
	_recordFormatOp(changes.map(c => c.id), sn, () => {
		for (const { id, url } of changes) formats.applyToRange([id], { hyperlink: url }, sn)
	})
	refreshActiveFormat()
	grid?.render()
	syncFlags()
}

function openHyperlinkDialog() {
  const id  = activeCell.value
  const cur = sheet.getCell(id)
  const fmt = formats.get(id, sheet.getCurrentSheet())
  hyperlinkText.value = String(cur ?? '')
  hyperlinkUrl.value  = fmt.hyperlink || ''
  showHyperlinkDialog.value = true
}

function confirmHyperlink() {
  const url = (hyperlinkUrl.value || '').trim()
  if (!url) { showHyperlinkDialog.value = false; return }
  const id = activeCell.value
  const sh = sheet.getCurrentSheet()
  if (_cellBlocked(id, sh)) { showHyperlinkDialog.value = false; return }
  if (hyperlinkText.value !== sheet.getCell(id)) sheet.setCell(id, hyperlinkText.value)
  formats.applyToRange([id], { hyperlink: url }, sh)
  history.push()   // post-mutate
  refreshActiveFormat()
  grid?.render()
  syncFlags()
  isDirty.value = true
  showHyperlinkDialog.value = false
}

function removeHyperlink() {
  const id = activeCell.value
  const sh = sheet.getCurrentSheet()
  formats.applyToRange([id], { hyperlink: null }, sh)
  history.push()   // post-mutate
  refreshActiveFormat()
  grid?.render()
  syncFlags()
  isDirty.value = true
  showHyperlinkDialog.value = false
}

// ── Link hover card ───────────────────────────────────────────────────────────
// Google-style preview card over a linked cell: favicon/title/description from
// the server (see suite/sheets/link_preview.py), plus copy / edit / unlink
// actions and the "Replace URL with its title?" offer for auto-linked cells.

const linkCard = reactive({
  open: false, id: null, r: 0, c: 0, url: '',
  anchor: null,        // { x, y } canvas-local px
  preview: {},         // { loading, error, title, description, favicon, host }
  offerReplace: false,
})
let _linkShowTimer = null
let _linkHideTimer = null

// Canvas feed — fires once on entering/leaving a linked cell. Short delays on
// both edges so the card neither flickers during a sweep across links nor
// vanishes while the pointer travels from the cell into the card.
function _onLinkHover(info) {
  if (info) {
    clearTimeout(_linkHideTimer)
    if (linkCard.open && linkCard.id === info.id && linkCard.url === info.url) return
    clearTimeout(_linkShowTimer)
    _linkShowTimer = setTimeout(() => _openLinkCard(info), 300)
  } else {
    clearTimeout(_linkShowTimer)
    _scheduleLinkCardHide()
  }
}

function _scheduleLinkCardHide() {
  clearTimeout(_linkHideTimer)
  _linkHideTimer = setTimeout(() => { linkCard.open = false }, 250)
}

function onLinkCardEnter() { clearTimeout(_linkHideTimer) }
function onLinkCardLeave() { _scheduleLinkCardHide() }

function _openLinkCard(info) {
  const rect = grid?.getCellRect?.(info.r, info.c)
  if (!rect) return
  const CARD_W = 340, EST_H = 120
  const wrapW = gridWrapRef.value?.offsetWidth  ?? Infinity
  const wrapH = gridWrapRef.value?.offsetHeight ?? Infinity
  const x = Math.max(0, Math.min(rect.x, wrapW - CARD_W - 8))
  const y = rect.y + rect.height + EST_H > wrapH
          ? Math.max(0, rect.y - EST_H)
          : rect.y + rect.height + 2
  const isHttp = /^https?:\/\//i.test(info.url)
  Object.assign(linkCard, {
    open: true, id: info.id, r: info.r, c: info.c, url: info.url,
    anchor: { x, y },
    preview: isHttp ? { loading: true } : {},
    offerReplace: false,
  })
  if (!isHttp) return
  fetchLinkPreview(info.url).then(res => {
    // Pointer may have moved on — only fill the card still showing this URL.
    if (!linkCard.open || linkCard.url !== info.url) return
    linkCard.preview = { ...res, loading: false }
    linkCard.offerReplace = !readOnly.value
      && !!res.title
      && isAutoLinkText(sheet.getCell(linkCard.id), linkCard.url)
      && !_cellSilentlyProtected(linkCard.id)
  })
}

function openLinkCardUrl() {
  window.open(linkCard.url, '_blank', 'noopener,noreferrer')
}

function editLinkCardCell() {
  linkCard.open = false
  grid?.moveTo?.(linkCard.r, linkCard.c)   // onSelect syncs activeCell
  openHyperlinkDialog()
}

function unlinkLinkCardCell() {
  const sn = sheet.getCurrentSheet()
  const id = linkCard.id
  linkCard.open = false
  if (!id || readOnly.value || _cellBlocked(id, sn)) return
  _recordFormatOp([id], sn, () => formats.applyToRange([id], { hyperlink: null }, sn))
  refreshActiveFormat()
  grid?.render()
  syncFlags()
  isDirty.value = true
}

function replaceLinkWithTitle() {
  const sn    = sheet.getCurrentSheet()
  const id    = linkCard.id
  const title = linkCard.preview?.title
  linkCard.open = false
  if (!id || !title || readOnly.value || _cellBlocked(id, sn)) return
  const before = { [id]: sheet.getCell(id, sn) }
  sheet.setCell(id, title, sn)
  _pushEditOp(sn, before, 'Replace URL with title')
  if (activeCell.value === id) formulaValue.value = title
}

function openInsertMany(kind, below = false) {
  contextMenu.open = false
  insertMany.kind  = kind
  insertMany.below = below
  insertMany.count = 5
  showInsertManyDialog.value = true
}

function confirmInsertMany() {
  const n = Math.max(1, Math.min(1000, parseInt(insertMany.count, 10) || 1))
  showInsertManyDialog.value = false
  if (insertMany.kind === 'row') doInsertRow(insertMany.below, n)
  else                            doInsertCol(insertMany.below, n)
}

function doDeleteRow() {
  contextMenu.open = false
  // Same span logic as doDeleteCol: delete the whole selected row block when
  // the right-clicked row falls inside it, else just the targeted row. Only a
  // real row span counts — in 'col'/'all' selections getSelection() reports
  // r1 = last row, which would otherwise delete every row below the target.
  const sel = grid.getSelection()
  const rowSpan = sel && (sel.mode === 'row' || sel.mode === 'cell')
  const within = rowSpan && contextMenu.targetRow >= sel.r0 && contextMenu.targetRow <= sel.r1
  const start  = within ? sel.r0 : contextMenu.targetRow
  const count  = within ? sel.r1 - sel.r0 + 1 : 1
  _applyRowStructural(deleteMap(start, count))
}

// Fan one column index-map across every engine and the grid's view metadata,
// then refresh. This is the single structural-column path behind insert, delete
// AND move — every one is reference-correct because sheet.remapCols rewrites
// formulas workbook-wide. The workbook-level engines (merge/charts/pivot/named)
// filter internally to the op sheet, so passing `sn` is safe.
function _applyColStructural(mapCol) {
  const sn = sheet.getCurrentSheet()
  sheet.remapCols(mapCol, sn)
  formats.remapCols(mapCol, sn)
  merge.remapCols(mapCol, sn)
  comments.remapCols(mapCol, sn)
  validation.remapCols(mapCol, sn)
  protection.remapCols(mapCol, sn)
  condFormat.remapCols(mapCol, sn)
  sortFilter.remapCols(mapCol, sn)
  slicers.remapCols(mapCol, sn)
  namedRanges.remapCols(mapCol, sn)
  charts.remapCols(mapCol, sn)
  pivot.remapCols(mapCol, sn)
  grid.remapColsMeta(mapCol)
  _repopulateGrid()
  _applyHiddenRows()
  markEdited()
  recomputePivotsForSheet(sn)
}

function doInsertCol(right = false, count = 1) {
  contextMenu.open = false
  const atCol = contextMenu.targetCol + (right ? 1 : 0)
  _applyColStructural(insertMap(atCol, count))
}

function doDeleteCol() {
  contextMenu.open = false
  // When the right-clicked column is inside a multi-column selection, delete
  // every selected column; otherwise just the targeted one.
  // Only a real column span counts — in 'row'/'all' selections getSelection()
  // reports c1 = last col, which would otherwise delete every column to the right.
  const sel = grid.getSelection()
  const colSpan = sel && (sel.mode === 'col' || sel.mode === 'cell')
  const within = colSpan && contextMenu.targetCol >= sel.c0 && contextMenu.targetCol <= sel.c1
  const start  = within ? sel.c0 : contextMenu.targetCol
  const count  = within ? sel.c1 - sel.c0 + 1 : 1
  _applyColStructural(deleteMap(start, count))
}

// Move a column block so its new start sits before column `toCol` (an index in
// the pre-move space, the drop target). No-op when dropped inside its own span.
function doMoveCol(fromCol, toCol, count = 1) {
  contextMenu.open = false
  if (toCol >= fromCol && toCol <= fromCol + count) return
  _applyColStructural(moveMap(fromCol, toCol, count))
  // Keep the moved column(s) selected at their new home (Google behaviour), so
  // the header highlight and the status-bar summary track the data that moved.
  const dest = toCol <= fromCol ? toCol : toCol - count
  grid.setSelection({ r0: 0, c0: dest, r1: 1e7, c1: dest + count - 1, mode: 'col' })
}

// Menu / palette: nudge the targeted column one position. Left drops it before
// its left neighbour; right drops it after its right neighbour (toCol is a
// pre-move "insert before" index, so right is targetCol + 2).
function doMoveColLeft()  { const c = contextMenu.targetCol; if (c > 0) doMoveCol(c, c - 1, 1) }
function doMoveColRight() { const c = contextMenu.targetCol; doMoveCol(c, c + 2, 1) }

function doAutoFitCol() {
  contextMenu.open = false
  grid?.autoFitCol(contextMenu.targetCol)
  history.push()
  isDirty.value = true
}

function doAutoFitRow() {
  contextMenu.open = false
  grid?.autoFitRow(contextMenu.targetRow)
  history.push()
  isDirty.value = true
}

// ── Borders ───────────────────────────────────────────────────────────────────

function applyBorder(preset) {
  if (!grid) return
  const { r0, c0, r1, c1 } = grid.getSelection()
  const sheetName = sheet.getCurrentSheet()
  const b = { style: borderStyle.value, color: borderColor.value }

  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const id = colLabel(c) + (r + 1)
      const isTop = r === r0, isBottom = r === r1
      const isLeft = c === c0, isRight = c === c1
      let upd = {}
      if (preset === 'none') {
        upd = { borderTop: null, borderBottom: null, borderLeft: null, borderRight: null }
      } else if (preset === 'all') {
        upd = { borderTop: b, borderBottom: b, borderLeft: b, borderRight: b }
      } else if (preset === 'outside') {
        if (isTop)    upd.borderTop    = b
        if (isBottom) upd.borderBottom = b
        if (isLeft)   upd.borderLeft   = b
        if (isRight)  upd.borderRight  = b
      } else if (preset === 'inner') {
        if (!isTop)    upd.borderTop    = b
        if (!isBottom) upd.borderBottom = b
        if (!isLeft)   upd.borderLeft   = b
        if (!isRight)  upd.borderRight  = b
      } else if (preset === 'top')    { upd.borderTop    = b }
        else if (preset === 'bottom') { upd.borderBottom = b }
        else if (preset === 'left')   { upd.borderLeft   = b }
        else if (preset === 'right')  { upd.borderRight  = b }
      if (Object.keys(upd).length) formats.applyToRange([id], upd, sheetName)
    }
  }
  markEdited()
  grid.render()
}

// ── Merge ─────────────────────────────────────────────────────────────────────

function toggleMerge() {
  if (!grid) return
  const sn = sheet.getCurrentSheet()
  const { r0, c0, r1, c1 } = grid.getSelection()
  // Resolve the anchor cell to its master — clicking inside the merged
  // region (slave or master) should target the existing merge so the
  // user can unmerge by single-clicking and hitting the toolbar button.
  const anchor   = colLabel(c0) + (r0 + 1)
  const masterId = merge.resolveId(anchor, sn)
  const wasMaster   = merge.isMaster(masterId, sn)
  const beforeMerge = merge.snapshot()
  if (wasMaster) {
    // Always allow unmerge, even on a 1×1 selection. Use the master's
    // actual span rather than the user's selection — the selection is
    // often just the master cell coords and would miss the slaves.
    const info = merge.getMasterInfo(masterId, sn)
    merge.unmerge(info.r, info.c, info.r + info.rowSpan - 1, info.c + info.colSpan - 1, sn)
  } else {
    if (r0 === r1 && c0 === c1) return   // nothing to merge in a single cell
    merge.merge(r0, c0, r1, c1, sn)
  }
  const afterMerge = merge.snapshot()
  // No structural change (rare — defensive) — skip the history entry.
  if (JSON.stringify(beforeMerge) === JSON.stringify(afterMerge)) {
    grid.render()
    return
  }
  // Route through op-based history so undo restores the exact previous
  // merge map. The merge engine's snapshot/restore round-trip is what
  // revertOp/applyOp call when an op carries beforeMerge/afterMerge.
  // Cell values aren't affected (merge.merge doesn't clobber them), so
  // before/after for cell values are intentionally empty maps.
  const op = {
    opType:   wasMaster ? 'unmerge' : 'merge',
    subSheet: sn,
    cellRefs: [],
    before:   {},
    after:    {},
    beforeMerge, afterMerge,
    summary:  wasMaster ? 'Unmerged cells' : 'Merged cells',
  }
  history.pushOp(op)
  syncFlags()
  isDirty.value = true
  grid.render()
}

// ── Freeze ────────────────────────────────────────────────────────────────────

function doFreezeRow() {
  contextMenu.open = false
  freezeRows.value = contextMenu.targetRow + 1
  grid?.setFreeze(freezeRows.value, freezeCols.value)
  history.push(); isDirty.value = true
}

function doFreezeCol() {
  contextMenu.open = false
  freezeCols.value = contextMenu.targetCol + 1
  grid?.setFreeze(freezeRows.value, freezeCols.value)
  history.push(); isDirty.value = true
}

function doUnfreezeRows() {
  contextMenu.open = false
  freezeRows.value = 0
  grid?.setFreeze(freezeRows.value, freezeCols.value)
  history.push(); isDirty.value = true
}

function doUnfreezeCols() {
  contextMenu.open = false
  freezeCols.value = 0
  grid?.setFreeze(freezeRows.value, freezeCols.value)
  history.push(); isDirty.value = true
}

// ── Hide / unhide rows & cols ─────────────────────────────────────────────────

// Manual hides kept in reactive state so the context menu can conditionally
// render "Unhide all". Filter hides live in sortFilter; we merge both when
// pushing to the canvas via _applyHiddenRows().
const manualHiddenRows = reactive(new Set())
const manualHiddenCols = reactive(new Set())

function _applyHiddenRows() {
  const filterHidden = sortFilter.computeHiddenRows(sheet.getCurrentSheet())
  const union = new Set([...filterHidden, ...manualHiddenRows])
  grid?.setHiddenRows(union)
  // Tag the filter subset so grid-painter can render those gaps with the
  // regular gridline color instead of the bold "rows hidden here" stroke.
  grid?.setFilterHiddenRows(filterHidden)
  // The filter state just changed (panel, sort, undo, sheet switch, or a
  // slicer) — refresh any open slicer's checklist so both controls agree.
  slicerVersion.value++
}

function _applyHiddenCols() {
  grid?.setHiddenCols(new Set(manualHiddenCols))
}

function doHideRows() {
  contextMenu.open = false
  if (!grid) return
  const { r0, r1 } = grid.getSelection()
  for (let r = r0; r <= r1; r++) manualHiddenRows.add(r)
  _applyHiddenRows()
  history.push(); isDirty.value = true
}

function doHideCols() {
  contextMenu.open = false
  if (!grid) return
  const { c0, c1 } = grid.getSelection()
  for (let c = c0; c <= c1; c++) manualHiddenCols.add(c)
  _applyHiddenCols()
  history.push(); isDirty.value = true
}

function doUnhideAllRows() {
  contextMenu.open = false
  manualHiddenRows.clear()
  _applyHiddenRows()
  history.push(); isDirty.value = true
}

function doUnhideAllCols() {
  contextMenu.open = false
  manualHiddenCols.clear()
  _applyHiddenCols()
  history.push(); isDirty.value = true
}


// ── Cmd+K command palette ─────────────────────────────────────────────────────
// CommandPalette ships its own Cmd+K listener that flips `showCmdPalette`.
const showCmdPalette = ref(false)
const cmdQuery       = ref('')

const cmdGroups = computed(() => buildCommandGroups({
  toggleFmt, setAlign, setValign, adjustDecimals, toggleWrap, clearFormatting,
  undo, redo, repeatLast, showFindReplace, openFindReplace, showFormulas, repopulateGrid: _repopulateGrid, showShortcutsHelp,
  contextMenu, getGrid: () => grid,
  doInsertRow, doDeleteRow, doInsertCol, doDeleteCol,
  doMoveColLeft, doMoveColRight,
  doHideRows, doHideCols, doUnhideAllRows, doUnhideAllCols,
  doAutoFitCol, doAutoFitRow, toggleMerge, addRowsCount, doAddMoreRows,
  doFreezeRow, doFreezeCol, doUnfreezeRows, doUnfreezeCols, showSortFilter,
  openPivotDialog,
  addSheet, currentSheet, openRenameDialog, doDuplicateSheet, doDeleteSheet,
  onSave, exportCSV, exportXLSX, exportPDF, csvInputRef, xlsxInputRef,
}))

function onCmdSelect(item) { item?.fn?.() }

// ── Helpers ───────────────────────────────────────────────────────────────────

// Returns { before, after, refs } for cells whose value actually changed.
// Separating diff from mutation keeps onBatchCommit readable and testable.
function diffCells(cells, getCell) {
  const before = {}, after = {}
  for (const { id, value } of cells) {
    const previous = getCell(id)
    if (previous !== value) { before[id] = previous; after[id] = value }
  }
  return { before, after, refs: Object.keys(after) }
}

// Snapshot the undo history, sync undo/redo button state, and flag the doc dirty.
// Called after every user mutation that should be undoable and trigger auto-save.
function markEdited() {
  history.push()
  syncFlags()
  isDirty.value = true
}

// pushEditOp is the diff-and-record helper for cell-edit paths
// (formula bar, Ctrl+D / Ctrl+R, cut, dropdown pick). Lives in
// ./useEditOps.js so the contract is unit-testable in isolation;
// see that file for the rationale on op-based vs snapshot history.
const { pushEditOp: _pushEditOp } = useEditOps({
  sheet, history,
  queueOp:              _queueOp,
  broadcastBatchChange: (sn, cells) => broadcastBatchChange(sn, cells),
  syncFlags,
  isDirty,
})

// ── Repopulate ────────────────────────────────────────────────────────────────

// Lazy render path is the default (Phase 3 cutover): the grid pulls each
// visible cell's display string on demand, so switch/load cost no longer scales
// with cell count. The eager `data`-cache path is kept intact as a fallback —
// disable lazy per-browser with `?lazy=0` or localStorage['sheets:lazy']='0' if
// a rendering regression turns up on a real sheet.
function _lazyValuesEnabled() {
  try {
    if (new URLSearchParams(window.location.search).get('lazy') === '0') return false
    if (window.localStorage?.getItem('sheets:lazy') === '0') return false
  } catch { /* no window/storage — fall through to default */ }
  return true
}

// Display string for a single cell — the formatted value the canvas paints.
// Single source of truth shared by the eager repopulate (below), the per-cell
// onCellChanged repaint, and the lazy render path (grid `getDisplay`), so all
// three render identical pixels. showFormulas mode paints raw formula text.
function _cellDisplay(id) {
  if (showFormulas.value) return String(sheet.getCell(id) ?? '')
  const sn  = sheet.getCurrentSheet()
  const fmt = formats.get(id, sn)
  const dv  = sheet.getDisplayValue(id)
  return fmt.numberFormat ? applyNumberFmt(dv, fmt.numberFormat) : dv
}

// Grow the grid's scrollable area to cover a sheet's used extent so the user
// can scroll to their data. Shared by the eager and lazy repopulate paths.
function _expandGridTo(maxCol, maxRow) {
  const neededCols = maxCol + 1
  const neededRows = maxRow + 1
  if (grid.getTotalCols && grid.expandCols && neededCols > grid.getTotalCols())
    grid.expandCols(neededCols - grid.getTotalCols())
  if (grid.getTotalRows && grid.expandRows && neededRows > grid.getTotalRows())
    grid.expandRows(neededRows - grid.getTotalRows())
}

// Sheet extent via a cheap char-code id-parse over the raw cell ids — no
// formula eval or format work. The lazy path's fallback when the engine has
// no load-time bounds hint (post-edit / never-visited sheet).
function _scanBounds(sheetSn) {
  const data = sheet.getRawData(sheetSn)
  let maxCol = 0, maxRow = 0
  for (const id in data) {
    let col = 0, row = 0, i = 0
    const len = id.length
    while (i < len) { const c = id.charCodeAt(i); if (c < 65 || c > 90) break; col = col * 26 + (c - 64); i++ }
    while (i < len) { const c = id.charCodeAt(i); if (c < 48 || c > 57) { row = 0; break } row = row * 10 + (c - 48); i++ }
    if (col > 0 && row > 0) { if (col - 1 > maxCol) maxCol = col - 1; if (row - 1 > maxRow) maxRow = row - 1 }
  }
  return { maxCol, maxRow }
}

function _repopulateGrid() {
  if (!grid) return
  const sheetSn = sheet.getCurrentSheet()

  // Lazy path: the grid pulls each visible cell's display string on demand, so
  // we materialise nothing here — switch/load no longer scale with cell count.
  // Still size the grid to the sheet extent (cheap id-parse, or the engine's
  // free load-time hint) and repaint.
  if (grid.isLazyValues?.()) {
    const b = sheet.consumeBounds?.(sheetSn) || _scanBounds(sheetSn)
    _expandGridTo(b.maxCol, b.maxRow)
    grid.render?.()
    return
  }

  grid.clearAll()
  const data    = sheet.getRawData()
  const show    = showFormulas.value
  // Bounds: on load the engine hands us the sheet extent (derived cheaply from
  // the packed payload), so we skip re-parsing every cell id here entirely —
  // that scan was ~0.5s on a 2M-cell sheet. When bounds are unknown (post-edit
  // repopulates) we fall back to the inline char-code parse below.
  const bounds = sheet.consumeBounds?.(sheetSn)
  let maxCol = bounds ? bounds.maxCol : 0
  let maxRow = bounds ? bounds.maxRow : 0
  // for-in avoids allocating a 2M-entry Object.keys array (alloc + GC was a
  // measurable chunk of the cold-load task).
  for (const id in data) {
    if (!bounds) {
      // Inline cellId parse — letters → col index, then digits → row number.
      // No regex, no result object.
      let col = 0, row = 0, i = 0
      const len = id.length
      while (i < len) {
        const c = id.charCodeAt(i)
        if (c < 65 || c > 90) break
        col = col * 26 + (c - 64)
        i++
      }
      while (i < len) {
        const c = id.charCodeAt(i)
        if (c < 48 || c > 57) { row = 0; break }
        row = row * 10 + (c - 48)
        i++
      }
      if (col > 0 && row > 0) {
        if (col - 1 > maxCol) maxCol = col - 1
        if (row - 1 > maxRow) maxRow = row - 1
      }
    }

    if (show) {
      grid.setCell(id, String(data[id] ?? ''))
      continue
    }
    const fmt = formats.get(id, sheetSn)
    const displayValue = sheet.getDisplayValue(id)
    grid.setCell(id, fmt.numberFormat ? applyNumberFmt(displayValue, fmt.numberFormat) : displayValue)
  }
  _expandGridTo(maxCol, maxRow)
}

function toggleShowFormulas() {
  showFormulas.value = !showFormulas.value
  _repopulateGrid()
}
</script>

<style scoped>
/* Espresso tokens — every color comes from frappe-ui's semantic palette
   (--surface-*, --outline-*, --ink-*). No raw Tailwind hexes. */

/* ── Root layout ─────────────────────────────────────────────────────────── */
.sn-root { display:flex; flex-direction:column; height:100vh; overflow:hidden; background:var(--surface-base); font-family:InterVar, ui-sans-serif, system-ui, sans-serif; color:var(--ink-gray-9); }

/* ── Canvas loading overlay ──────────────────────────────────────────────── */
/* Sits inside .sn-grid-wrap. The canvas is mounted underneath (the grid
   engine needs the canvas ref to wire up before loadSheet returns), so
   this is a translucent veil that fades when isInitialLoad flips. */
.sn-canvas-loading {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  background: var(--surface-base);
  z-index: 1;
  pointer-events: none;   /* don't intercept clicks if it lingers a frame */
}
.sn-canvas-loading-spinner { color: var(--ink-gray-5); }
.sn-pivot-building {
  position: absolute; top: 12px; left: 50%; transform: translateX(-50%);
  display: flex; align-items: center; gap: 8px;
  padding: 6px 14px; border-radius: 999px;
  background: var(--surface-base); border: 1px solid var(--outline-gray-2);
  box-shadow: 0 2px 8px rgba(0,0,0,.08);
  font-size: 13px; color: var(--ink-gray-7);
  z-index: 5; pointer-events: none;
}

/* ── Load-time error state ───────────────────────────────────────────────── */
.sn-load-error {
  flex: 1; display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 12px; padding: 24px; text-align: center;
}
.sn-load-error-icon  { line-height: 0; margin-bottom: 4px; }
.sn-load-error-title { font-size: 16px; font-weight: 600; color: var(--ink-gray-9); margin: 0; }
.sn-load-error-sub   { font-size: 13px; color: var(--ink-gray-6); margin: 0 0 8px; max-width: 360px; }

/* ── Bar 1 · Identity / topbar ───────────────────────────────────────────── */
.sn-topbar       { position:relative; z-index:10; display:flex; align-items:center; justify-content:space-between; height:48px; padding:0 12px; border-bottom:1px solid var(--outline-elevation-1); background:var(--surface-elevation-1); flex-shrink:0; }
/* Left cluster groups: brand+title tight (gap:4); status chips sit further away
   (gap:12) so the title reads as the focal point, not crowded by badges. */
.sn-topbar-left  { display:flex; align-items:center; gap:8px; min-width:0; }
.sn-topbar-right { display:flex; align-items:center; gap:6px; flex-shrink:0; }
.sn-identity { display:flex; min-width:0; align-items:center; }

.sn-app-icon { width:28px; height:28px; flex-shrink:0; display:block; }
.sn-app-menu-trigger { display:flex; width:fit-content; align-items:center; gap:8px; cursor:pointer; }
.sn-parent-breadcrumb :deep(a) { color:var(--ink-gray-5); }

/*
   intrinsic ~20ch width is taken out of the layout — otherwise it, not the
   text, would dictate the box. Result: the box hugs the text and grows smoothly
   per keystroke, with no width animation lagging the caret and no canvas
   measurement drifting from actual metrics. min/max-width keep the old
   click-target floor and runaway-title ceiling. */
/* Hairline between action buttons and avatar — groups the cluster without
   relying on extra padding. */
.sn-topbar-divider { width:1px; height:20px; background:var(--outline-gray-2); margin:0 4px; flex-shrink:0; }
/* Notes count badge — workbook-wide teal badge on the notes icon. */
.sn-notes-btn-wrap { position:relative; display:inline-flex; }
.sn-notes-badge {
  position:absolute; top:-3px; right:-3px; box-sizing:border-box;
  min-width:15px; height:15px; padding:0 3px;
  display:flex; align-items:center; justify-content:center;
  font-size:9px; font-weight:600; line-height:1; color:#fff;
  background:#0d7490; border-radius:999px; border:1.5px solid var(--surface-base);
  pointer-events:none;
}

/* Brand-coloured current-user avatar. Avatar's inner label uses
   `bg-surface-gray-2 text-ink-gray-5` by default — we override both so the
   chip reads as "you" against the otherwise-neutral topbar. Scoped styles
   need `:deep()` to reach into frappe-ui's component internals. */
.sn-user-avatar :deep(div) { background: #0D7490 !important; color: #FFFFFF !important; }

/* Presence avatars — stacked/overlapping, each with a white ring so they
   visually separate even when colors are similar. */
.sn-presence { display:inline-flex; align-items:center; }
.sn-presence-avatar {
  margin-left:-6px; border-radius:50%;
  /* Outer ring = surface bg so the stack reads as overlapping pebbles;
     inner ring = the peer's cursor color so the avatar matches their
     cursor outline at a glance. `box-shadow` stacks two rings without
     pushing layout. */
  box-shadow: 0 0 0 2px var(--surface-base),
              0 0 0 4px var(--rc, var(--outline-gray-2));
}
.sn-presence-avatar:first-child { margin-left:0; }
.sn-presence-more {
  display:inline-flex; align-items:center; justify-content:center;
  width:26px; height:26px; border-radius:50%;
  background:var(--surface-gray-3); border:2px solid var(--surface-base);
  margin-left:-6px; font-size:10px; font-weight:600; color:var(--ink-gray-7);
  flex-shrink:0; cursor:default;
}

/* Save status — small muted text, Espresso ink-gray-5.  Sits quietly next to
   the title; never competes for attention. */
.sn-save-status { display:inline-flex; align-items:center; gap:4px; font-size:12px; font-weight:400; letter-spacing:.01em; color:var(--ink-gray-5); white-space:nowrap; user-select:none; }
.sn-save-icon   { width:12px; height:12px; flex-shrink:0; }
@keyframes sn-spin { to { transform:rotate(360deg); } }
.sn-save-spin   { animation:sn-spin .9s linear infinite; }

/* ── Pivot FAB ── */
.sn-pivot-fab {
  position: absolute; z-index: 20;
  width: 28px; height: 28px; border-radius: 50%;
  background: var(--surface-base);
  border: 1px solid var(--outline-gray-2);
  box-shadow: 0 2px 8px rgba(0,0,0,.12);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; color: var(--ink-gray-6);
  transition: background .1s, color .1s, box-shadow .1s;
}
.sn-pivot-fab:hover, .sn-pivot-fab.open {
  background: var(--surface-gray-1);
  color: var(--ink-gray-9);
  box-shadow: 0 3px 12px rgba(0,0,0,.16);
}
.sn-pivot-fab-icon { width: 13px; height: 13px; }

/* Pivot highlight overlay — neutral outline drawn over the pivot output
   range, matching the rest of the espresso chrome (ink-gray scale rather
   than a saturated brand colour). pointer-events:none keeps clicks
   reaching the canvas underneath. */
.sn-pivot-highlight {
  position: absolute; z-index: 15; pointer-events: none;
  border: 1.5px solid var(--ink-gray-8);
  border-radius: 2px;
}

/* Filter range outline — same neutral chrome as the pivot highlight, drawn
   around the active filter's rectangle so its extent is visible. pointer-events
   stays off so the chevron buttons and canvas underneath keep receiving clicks. */
.sn-filter-range {
  position: absolute; z-index: 14; pointer-events: none;
  /* Thin green outline, Google-Sheets-style — a 1.5px near-black frame read
     as far too heavy against the gridlines. */
  border: 1px solid var(--ink-green-3, #15803d);
  border-radius: 2px;
}

/* ── Bar 2 · Formula bar ─────────────────────────────────────────────────── */

.sn-formula-bar   { display:flex; align-items:center; height:48px; padding:0 16px; border-bottom:1px solid var(--outline-gray-2); gap:8px; flex-shrink:0; background:var(--surface-base); }
/* Cell address tag */
.sn-cell-ref      { box-sizing:border-box; min-width:50px; padding:0 8px; flex-shrink:0; text-align:center; font-size:12px; font-weight:600; letter-spacing:.04em; color:var(--ink-gray-7); background:var(--surface-base); border:1px solid var(--outline-gray-2); border-radius:6px; height:30px; line-height:1; display:flex; align-items:center; justify-content:center; font-variant-numeric:tabular-nums; font-family:ui-monospace, "SF Mono", Menlo, Consolas, monospace; cursor:default; user-select:none; transition:border-color .12s, background-color .12s; }
.sn-cell-ref:hover { border-color:var(--outline-gray-3); background:var(--surface-gray-3); }
/* "fx" delimiter */
.sn-fx-label      { font-size:14px; font-style:italic; font-weight:500; color:var(--ink-gray-4); letter-spacing:.02em; flex-shrink:0; padding:0 6px 0 2px; user-select:none; font-family:ui-serif, Georgia, "Times New Roman", serif; }
.sn-formula-wrap  { position:relative; flex:1; display:flex; }
.sn-formula-wrap .sn-formula-input { flex:1; }
.sn-formula-input { box-sizing:border-box; width:100%; height:30px; line-height:1; border-radius:6px; outline:none; padding:0 10px; font-size:13px; color:var(--ink-gray-8); background:var(--surface-base); border:1px solid var(--outline-gray-2); font-family:'Fira Code', ui-monospace, 'SF Mono', Menlo, Consolas, monospace; letter-spacing:.005em; transition:background-color .15s, border-color .15s, box-shadow .15s; }
.sn-formula-input::placeholder { color:var(--ink-gray-3); font-style:italic; font-family:inherit; }
.sn-formula-input:hover { background:var(--surface-gray-3); border-color:var(--outline-gray-3); }
.sn-formula-input:focus { border-color:var(--outline-gray-4); background:var(--surface-base); box-shadow:0 0 0 2px rgba(23,23,23,.08); }
.sn-fbar-actions  { display:flex; align-items:center; gap:6px; flex-shrink:0; margin-left:4px; }

/* Formula autocomplete — Frappe UI Autocomplete is form-field oriented, so the inline popover is bespoke but uses Espresso surfaces. */
.sn-ac-list       { position:absolute; top:calc(100% + 4px); bottom:auto; left:0; right:0; background:var(--surface-elevation-2); border:1px solid var(--outline-gray-2); border-radius:8px; box-shadow:0 0 1px rgba(0,0,0,.35), 0 6px 8px -4px rgba(0,0,0,.1); z-index:300; max-height:240px; overflow-y:auto; padding:4px; }
.sn-ac-list--up   { top:auto; bottom:calc(100% + 4px); }
.sn-ac-item  { display:flex; align-items:baseline; gap:10px; padding:6px 10px; cursor:pointer; white-space:nowrap; border-radius:4px; }
.sn-ac-item:hover, .sn-ac-item.active { background:var(--surface-gray-2); }
.sn-ac-name  { font-weight:600; font-size:13px; color:var(--ink-gray-9); min-width:90px; letter-spacing:.02em; }
.sn-ac-sig   { font-size:11px; color:var(--ink-gray-5); letter-spacing:.01em; }
.sn-ac-badge { font-size:10px; font-weight:600; text-transform:uppercase; letter-spacing:.04em; color:var(--ink-cyan-6, #0891b2); background:var(--surface-cyan-1, #ecfeff); border-radius:3px; padding:1px 5px; }
/* Validation dialog two-column value row */
.sn-vd-vals  { display:grid; grid-template-columns:1fr 1fr; gap:12px; }

/* Validation "List of items" per-item editor: swatch · label · remove */
.sn-vd-list       { display:flex; flex-direction:column; gap:6px; }
.sn-vd-list-label { font-size:12px; color:var(--ink-gray-5); }
.sn-vd-item       { display:flex; align-items:center; gap:8px; }
.sn-vd-swatch     { flex-shrink:0; width:28px; height:28px; border-radius:6px; border:1px solid var(--outline-gray-2); cursor:pointer; padding:0; }
.sn-vd-swatch:hover, .sn-vd-swatch.is-open { box-shadow:0 0 0 2px var(--surface-base), 0 0 0 3.5px var(--outline-gray-4); }
.sn-vd-item-input { flex:1; min-width:0; height:28px; padding:0 10px; font-size:13px; border:1px solid var(--outline-gray-2); border-radius:8px; color:var(--ink-gray-9); background:var(--surface-base); outline:none; }
.sn-vd-item-input:focus { border-color:var(--outline-gray-4); }
.sn-vd-item-x     { flex-shrink:0; display:inline-flex; align-items:center; justify-content:center; width:28px; height:28px; border-radius:6px; border:none; background:transparent; color:var(--ink-gray-5); cursor:pointer; }
.sn-vd-item-x:hover { background:var(--surface-gray-2); color:var(--ink-gray-8); }
.sn-vd-item-xg    { width:15px; height:15px; }
.sn-vd-add        { align-self:flex-start; display:inline-flex; align-items:center; gap:5px; margin-top:2px; padding:4px 8px; font-size:13px; font-weight:500; color:var(--ink-gray-7); background:transparent; border:none; border-radius:6px; cursor:pointer; }
.sn-vd-add:hover  { background:var(--surface-gray-2); color:var(--ink-gray-9); }
.sn-vd-add-g      { width:14px; height:14px; }

/* ── Bar 3 · Formatting toolbar ──────────────────────────────────────────── */
.sn-toolbar { display:flex; align-items:center; gap:2px; height:44px; padding:0 15px; border-bottom:1px solid var(--outline-gray-2); background:var(--surface-base); flex-shrink:0; }
/* Read-only: dim and make the whole formatting bar inert. pointer-events:none
   swallows clicks on every control (buttons + dropdowns) without per-button
   wiring; the reduced opacity is the visual "disabled" cue. */
.sn-toolbar--readonly { opacity:.45; pointer-events:none; }
.sn-toolbar :deep(.fui-form-control) { width:auto; }
.sn-toolbar :deep(select) { min-width:118px; }
/* Font family dropdown — uses a Button trigger that hugs the short label. */
.sn-font-family :deep(button) { padding-left:6px; padding-right:4px; gap:2px; }

.sn-font-size-input { width:52px; margin:0 2px; }
.sn-font-size-input :deep(input) { text-align:center; font-variant-numeric:tabular-nums; -moz-appearance:textfield; }
.sn-font-size-input :deep(input::-webkit-outer-spin-button),
.sn-font-size-input :deep(input::-webkit-inner-spin-button) { -webkit-appearance:none; margin:0; }
.sn-vr  { width:1px; height:18px; background:var(--outline-gray-2); margin:0 6px; flex-shrink:0; }

/* Active-format pip — toolbar buttons (Bold / Italic / Underline /
   Strikethrough) flip from the default subtle gray to brand cyan-50 when
   their format is applied on the selected cell. Same hex as the active
   selection wash, so the eye learns "cyan = applied here". */
.sn-fmt-active :deep(button) {
  background: #ECF8FB !important;
  color: #0D7490 !important;
}
.sn-fmt-active :deep(button:hover) {
  background: #D8F1F6 !important;
}

/* Toolbar overflow — `.sn-tool-extra` groups stay inline at wide widths;
   collapse below 1280px into the `.sn-tool-more` "…" dropdown. Using
   `display:contents` on the wrappers means the buttons participate in the
   parent flex layout when shown, with zero visual nesting. */
.sn-tool-extra { display: contents; }
.sn-tool-more  { display: none; margin-left: auto; }
@media (max-width: 1280px) {
  .sn-tool-extra { display: none; }
  .sn-tool-more  { display: inline-flex; }
}

/* Color-picker trigger buttons (FeatherIcon glyph above a colored underline).
   These open the ColorPicker popover; the swatch grid + hex + custom live there. */
.sn-swatch-btn { position:relative; height:28px; width:28px; border-radius:6px; display:inline-flex; flex-direction:column; align-items:center; justify-content:center; cursor:pointer; border:1px solid transparent; gap:1px; transition:background-color .12s; background:transparent; padding:0; }
.sn-swatch-btn:hover, .sn-swatch-btn.is-open { background:var(--surface-gray-3); }
.sn-swatch-glyph     { width:14px; height:14px; color:var(--ink-gray-8); pointer-events:none; }
.sn-merge-glyph      { width:16px; height:16px; color:currentColor; pointer-events:none; }
.sn-swatch-underline { width:16px; height:3px; border-radius:1px; pointer-events:none; }
.sn-swatch-fill      { border:1px solid var(--outline-gray-2); }

/* ── Canvas grid ─────────────────────────────────────────────────────────── */
.sn-grid-wrap        { flex:1; overflow:hidden; position:relative; background:var(--surface-base); }
.sn-grid-wrap canvas { display:block; outline:none; }

.sn-painting-format canvas { cursor: crosshair; }
/* Lock canvas interactions while a past version is being previewed.  The
   side panel + banner stay clickable because they live inside the same
   wrap but are absolutely positioned with pointer-events: auto restored. */
.sn-preview-locked canvas { pointer-events: none; opacity: 0.95; }
.sn-preview-locked .sn-vh-panel { pointer-events: auto; }

/* ── Filter overlay (chevrons sit on row 0 of data — the user's header row) ── */
/* Covers the full canvas; button positions come from grid.colX() which already
   includes ROW_HEADER_W. The clip-path masks the row-number gutter (left 50px). */
/* clip-path keeps chevrons out of the row-header strip on the left (50px =
   ROW_HEADER_W) AND the column-header strip on top (24px = COL_HEADER_H);
   without the top inset, the chevrons follow row 0 up over A/B/C/D when
   the user scrolls past the header row. */
.sn-filter-overlay { position:absolute; inset:0; pointer-events:none; overflow:hidden; clip-path:inset(24px 0 0 50px); }
.sn-filter-btn     { position:absolute; border:1px solid var(--outline-gray-2); border-radius:4px; background:rgba(255,255,255,.92); cursor:pointer; pointer-events:all; padding:0; display:flex; align-items:center; justify-content:center; color:var(--ink-gray-7); box-shadow:0 1px 2px rgba(0,0,0,.05); transition:background-color .12s, border-color .12s, color .12s; }
.sn-filter-btn:hover  { background:var(--surface-base); border-color:var(--outline-gray-4); color:var(--ink-gray-9); }
.sn-filter-btn.active { background:var(--surface-gray-4); border-color:var(--outline-gray-4); color:var(--ink-gray-9); }
.sn-filter-btn-icon   { width:12px; height:12px; }

/* Remote selection rectangle — solid 2px border in the peer's hashed
   colour plus a soft fill so multi-cell ranges read as a region, not just
   an outline. `color-mix` falls back to a transparent rect on browsers
   that don't support it (all evergreen browsers do, and we use Chromium /
   WebKit / Firefox latest). */
.sn-remote-cursor {
  position:absolute; pointer-events:none; box-sizing:border-box;
  border:2px solid var(--rc);
  background: color-mix(in srgb, var(--rc) 10%, transparent);
  /* Default: no animation. The class below opts in for one paint cycle
     when the peer actually changes cells (vs. local scroll). */
  transition: none;
}
.sn-remote-cursor--moved {
  transition: left .12s ease-out, top .12s ease-out,
              width .12s ease-out, height .12s ease-out;
}
.sn-remote-cursor-label {
  position:absolute; top:-18px; left:-1px;
  background:var(--rc); color:var(--surface-base);
  font-size:10px; font-weight:600;
  padding:1px 5px; border-radius:3px 3px 3px 0;
  white-space:nowrap; line-height:16px;
  max-width:140px; overflow:hidden; text-overflow:ellipsis;
}

.sn-filter-panel { position:absolute; z-index:100; background:var(--surface-elevation-2); border:1px solid var(--outline-elevation-2); border-radius:10px; box-shadow:0 0 1px rgba(0,0,0,.35), 0 6px 8px -4px rgba(0,0,0,.1); padding:12px; width:260px; display:flex; flex-direction:column; gap:8px; }
.sn-fp-title   { font-size:12px; font-weight:600; letter-spacing:.02em; color:var(--ink-gray-8); padding-bottom:2px; }
.sn-fp-row     { display:flex; gap:4px; }
.sn-fp-mode    { display:flex; gap:2px; padding:2px; border:1px solid var(--outline-gray-2); border-radius:8px; background:var(--surface-base); }
.sn-fp-actions { display:flex; gap:4px; padding-top:2px; }
.sn-fp-grow    { flex:1; }

/* "Filter by values" mode — every interactive element is a Frappe UI primitive
   (Button, Checkbox, FormControl), so the per-class rules here only handle
   layout and the value-list row chrome. */
.sn-fp-vlinks         { display:flex; align-items:center; gap:2px; }
.sn-fp-count          { margin-left:auto; font-size:11px; letter-spacing:.02em; color:var(--ink-gray-5); }
.sn-fp-search-icon    { width:13px; height:13px; color:var(--ink-gray-5); }
.sn-fp-values         { max-height:200px; overflow-y:auto; border:1px solid var(--outline-gray-2); border-radius:8px; padding:4px 0; background:var(--surface-base); }
.sn-fp-value-row      { display:flex; align-items:center; gap:8px; padding:5px 10px; cursor:pointer; font-size:13px; letter-spacing:.01em; color:var(--ink-gray-8); }
.sn-fp-value-row:hover { background:var(--surface-gray-2); }
.sn-fp-value-text     { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.sn-fp-empty          { padding:12px 10px; font-size:12px; color:var(--ink-gray-5); text-align:center; }

/* ── Bottom · tabs + stats ───────────────────────────────────────────────── */
.sn-bottom { display:flex; align-items:stretch; height:36px; border-top:1px solid var(--outline-gray-2); background:var(--surface-sidebar); flex-shrink:0; overflow:hidden; }

.sn-tabs-track {
  display:flex; align-items:stretch; flex:1; gap:0;
  overflow-x:auto; overflow-y:hidden;
  scrollbar-width:none; padding:0 6px;
}
.sn-tabs-track::-webkit-scrollbar { display:none; }

.sn-tab {
  display:inline-flex; align-items:center; flex-shrink:0;
  position:relative; cursor:grab;
  /* The tab itself owns the pill background so label + chevron merge
     into a single visual unit — no inter-button seam, no double-pill
     look. The inner Buttons are transparent and rely on this wrapper
     for their background. */
  border-radius:6px;
  transition:background-color .12s;
}
.sn-tab:active { cursor:grabbing; }
.sn-tab:hover  { background:var(--surface-gray-2); }
.sn-tab--active,
.sn-tab--active:hover { background:var(--surface-gray-3); }

/* Active indicator: 2px line at the bottom */
.sn-tab--active::after {
  content:''; position:absolute; bottom:-2px; left:6px; right:6px;
  height:2px; background:var(--ink-gray-9); border-radius:1px 1px 0 0;
}
.sn-tab--pivot.sn-tab--active::after { background:var(--ink-cyan-7, #0e7490); }

/* Main label Button — transparent so the wrapper's pill shows through, with
   no internal hover/active background of its own; that lives on `.sn-tab`.
   frappe-ui forwards our `class` onto the <button> root itself (there is no
   inner button), so we style `.sn-tab-btn` directly — a `:deep(button)`
   descendant selector matches nothing and leaves the native ghost hover pill
   showing through, which is what made the label and chevron highlight as two
   separate pills. `background` is forced so it beats the native
   `hover:/active:` background utilities at equal specificity. */
.sn-tab-btn {
  font-size:12px; font-weight:400; color:var(--ink-gray-7);
  /* Tight right padding so the label flows directly into the chevron and
     the pair reads as one pill on every tab. */
  padding:0 2px 0 8px !important; height:28px;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  max-width:148px; border-radius:0 !important;
  background:transparent !important;
}
.sn-tab--active .sn-tab-btn { font-weight:600; color:var(--ink-gray-9); }

/* Pivot icon tint */
.sn-tab--pivot .sn-tab-btn :deep(.icon) { color:var(--ink-cyan-7, #0e7490); }

/* ── Per-tab peer dots ──────────────────────────────────────────────────
   One coloured circle per remote user currently looking at this tab.
   Sits in the tab's right edge, before the chevron when the tab is
   active. Capped to 3 visible + "+N" overflow so a popular tab can't
   blow out the tabs track. */
.sn-tab-peers {
  display:inline-flex; align-items:center; gap:2px;
  margin-right:6px; pointer-events:auto;
}
.sn-tab-peer-dot {
  display:inline-block; width:7px; height:7px;
  border-radius:50%; background:var(--rc);
  box-shadow:0 0 0 1px var(--surface-base);
}
.sn-tab-peer-more {
  font-size:9px; font-weight:600; color:var(--ink-gray-7);
  margin-left:2px; line-height:1;
}

/* Chevron — sits flush against the label inside the same pill so the two read
   as one button. Styled directly on the <button> (same reason as `.sn-tab-btn`
   above), transparent so it shares the wrapper's pill instead of drawing its
   own. `width:auto` overrides frappe-ui's fixed-square `w-7` so the chevron
   hugs the label rather than reserving a full 28px cell. Slightly muted on
   inactive tabs, full ink on the active one (matches the label's color). */
.sn-tab-chevron {
  padding:0 6px 0 0 !important;
  width:auto !important;
  height:28px;
  border-radius:0 !important;
  background:transparent !important;
  color:var(--ink-gray-5);
}
.sn-tab-chevron:hover { color:var(--ink-gray-9); }
.sn-tab--active .sn-tab-chevron { color:var(--ink-gray-8); }

/* Add-sheet button — the wrapper carries the divider + margins so the Button
   itself stays a clean square pill with its own contained hover box (any
   border/padding set on `.sn-tab-add` would land on the <button> root and
   distend its hover fill). Full-height flex box keeps the 28px button
   optically centered against the tab labels. */
.sn-tab-add-wrap {
  flex-shrink:0; display:flex; align-items:center; align-self:center;
  margin:0 8px 0 12px; padding-right:8px;
  border-right:1px solid var(--outline-gray-2);
}
/* Feather `plus` sits ~1px high inside its box; pull the glyph down so it
   lands on the same optical row as the tab labels' text. */
.sn-tab-add :deep(svg) { display:block; position:relative; top:1px; }

.sn-tab-drag-over::before {
  content:''; position:absolute; left:0; top:6px; bottom:6px;
  width:2px; background:var(--ink-gray-9); border-radius:1px;
}

.sn-stats { display:flex; align-items:center; gap:14px; padding:0 14px; font-size:11px; letter-spacing:.02em; color:var(--ink-gray-6); flex-shrink:0; white-space:nowrap; border-left:1px solid var(--outline-gray-2); height:100%; }

/* ── Right-click context menu (positioned at cursor; uses Frappe UI Buttons inside) ── */
.sn-ctx-menu { position:fixed; z-index:9000; background:var(--surface-elevation-2); border:1px solid var(--outline-elevation-2); border-radius:10px; box-shadow:0 0 1px rgba(0,0,0,.35), 0 6px 8px -4px rgba(0,0,0,.1); padding:4px; min-width:208px; display:flex; flex-direction:column; gap:1px; overflow-y:auto; }
/* Frappe UI Button defaults to `justify-content:center`. Override inside
   context menus so every row's icon sits at the same left padding and the
   labels line up regardless of length. */
.sn-ctx-menu :deep(button) { width:100%; justify-content:flex-start; padding-left:10px; padding-right:10px; }
.sn-ctx-sep { height:1px; background:var(--outline-gray-1); margin:4px 0; border:none; }
.sn-rename-err { margin:6px 0 0; font-size:12px; color:var(--ink-red-6); letter-spacing:.02em; }

/* Sheet-tab drag visual — Espresso ink-gray-9 left edge on the drop target. */
.sn-tab               { cursor:grab; }
.sn-tab:active        { cursor:grabbing; }

/* Viewer tabs — no chevron, no drag. The `.sn-tab-btn` right padding is only
   2px because it normally butts against the chevron; with the chevron gone the
   label needs its own symmetric breathing room. And a grab cursor lies about a
   tab that can't be dragged — clicking still switches sheets, so use pointer.
   Placed after the base `.sn-tab` cursor rules to win on equal specificity. */
.sn-tab--static,
.sn-tab--static:active            { cursor:pointer; }
.sn-tab--static .sn-tab-btn       { padding-right:8px !important; }

.sn-tab-drag-over::before {
  content: ''; position:absolute; left:-1px; top:4px; bottom:4px; width:2px;
  background: var(--ink-gray-9); border-radius:1px;
}

/* Add-more-rows strip — sits between the canvas and the bottom bar. */
.sn-addrows         { display:flex; align-items:center; gap:8px; height:32px; padding:0 12px; border-top:1px solid var(--outline-gray-2); background:var(--surface-sidebar); flex-shrink:0; }
.sn-addrows-label   { font-size:12px; letter-spacing:.02em; color:var(--ink-gray-6); }
.sn-addrows-input   { width:72px; height:24px; border:1px solid var(--outline-gray-2); border-radius:6px; padding:0 8px; font-size:12px; color:var(--ink-gray-9); background:var(--surface-base); font-family:inherit; outline:none; }
.sn-addrows-input:focus { border-color:var(--outline-gray-4); box-shadow:0 0 0 2px rgba(23,23,23,.10); }

/* Comment panel */
.sn-comment-panel  { position:fixed; z-index:8500; background:var(--surface-elevation-2); border:1px solid var(--outline-elevation-2); border-radius:10px; box-shadow:0 4px 16px rgba(0,0,0,.14); padding:12px; min-width:240px; display:flex; flex-direction:column; gap:8px; }

/* Slicers — floating value-filter controls */
.sn-slicer        { position:fixed; z-index:8400; width:220px; background:var(--surface-elevation-2); border:1px solid var(--outline-elevation-2); border-radius:10px; box-shadow:0 0 1px rgba(0,0,0,.35), 0 6px 8px -4px rgba(0,0,0,.1); padding:10px; display:flex; flex-direction:column; gap:8px; }
.sn-slicer-head   { display:flex; align-items:center; gap:6px; cursor:move; user-select:none; }
.sn-slicer-colsel { flex:1 1 auto; min-width:0; }
.sn-slicer-colsel :deep(button) { width:100%; justify-content:space-between; font-weight:600; }
.sn-slicer-colsel :deep(button > span) { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.sn-slicer-actions { margin:-2px 0; }
.sn-slicer-values { max-height:220px; overflow-y:auto; border:1px solid var(--outline-gray-2); border-radius:8px; padding:4px 0; background:var(--surface-base); }
.sn-comment-header { display:flex; align-items:center; justify-content:space-between; }
.sn-comment-title  { font-size:12px; font-weight:600; letter-spacing:.04em; color:var(--ink-gray-7); text-transform:uppercase; }
.sn-comment-close  { background:none; border:none; cursor:pointer; color:var(--ink-gray-5); font-size:14px; line-height:1; padding:2px 4px; }
.sn-comment-ta     { resize:vertical; font-family:inherit; font-size:13px; color:var(--ink-gray-9); background:var(--surface-gray-1); border:1px solid var(--outline-gray-2); border-radius:6px; padding:6px 8px; min-height:64px; outline:none; }
.sn-comment-ta:focus { border-color:var(--outline-gray-4); }
.sn-comment-actions { display:flex; gap:6px; justify-content:flex-end; }
.sn-comment-hactions { display:flex; align-items:center; gap:2px; }
.sn-comment-resolved { margin-left:6px; font-size:10px; font-weight:600; letter-spacing:.03em; text-transform:none; color:var(--ink-green-3, #15803d); background:var(--surface-green-2, #e4f3e9); border-radius:999px; padding:1px 7px; }
.sn-comment-thread  { display:flex; flex-direction:column; gap:10px; max-height:240px; overflow-y:auto; }
.sn-comment-reply   { display:flex; flex-direction:column; gap:2px; }
.sn-comment-reply-head { display:flex; align-items:center; gap:6px; }
.sn-comment-author  { font-size:12.5px; font-weight:600; color:var(--ink-gray-9); }
.sn-comment-time    { font-size:11px; color:var(--ink-gray-5); }
.sn-comment-del     { margin-left:auto; opacity:0; }
.sn-comment-reply:hover .sn-comment-del { opacity:1; }
.sn-comment-text    { font-size:13px; color:var(--ink-gray-8); white-space:pre-wrap; word-break:break-word; }

/* Notes side panel — docks the right edge of sn-grid-wrap, same dock as
   Version History (only one of the two is open at a time). */
.sn-notes-panel       { position:absolute; top:0; right:0; bottom:0; width:300px; background:var(--surface-base); border-left:1px solid var(--outline-gray-2); display:flex; flex-direction:column; z-index:30; box-shadow:-4px 0 12px -8px rgba(0,0,0,.08); animation:sn-notes-slide-in 160ms cubic-bezier(.2,.8,.25,1); }
@keyframes sn-notes-slide-in { from { transform:translateX(16px); opacity:0; } to { transform:translateX(0); opacity:1; } }
.sn-notes-header      { display:flex; align-items:center; justify-content:space-between; padding:10px 12px; border-bottom:1px solid var(--outline-gray-2); }
.sn-notes-title       { font-weight:600; color:var(--ink-gray-8); font-size:13px; display:flex; align-items:center; gap:6px; }
.sn-notes-count       { font-weight:400; color:var(--ink-gray-5); font-size:12px; }
.sn-notes-toolbar     { padding:8px 12px; border-bottom:1px solid var(--outline-gray-2); }
.sn-notes-empty       { padding:24px 16px; text-align:center; color:var(--ink-gray-5); }
.sn-notes-empty-title { font-size:13px; font-weight:500; color:var(--ink-gray-7); margin-bottom:6px; }
.sn-notes-empty-hint  { font-size:12px; line-height:1.5; }
.sn-notes-list        { flex:1; overflow-y:auto; padding:4px 0 12px; }
.sn-notes-group       { padding:4px 0; }
.sn-notes-group-h     { font-size:11px; font-weight:500; letter-spacing:.02em; color:var(--ink-gray-5); padding:8px 16px 4px; text-transform:uppercase; }
.sn-notes-row         { padding:8px 12px; margin:1px 6px; border-radius:6px; cursor:pointer; transition:background-color .12s; }
.sn-notes-row:hover   { background:var(--surface-gray-2); }
.sn-notes-row-active  { background:var(--surface-gray-2); box-shadow:inset 2px 0 0 var(--ink-gray-7); }
.sn-notes-row-ref     { font-size:12px; font-weight:600; color:var(--ink-gray-8); font-variant-numeric:tabular-nums; }
.sn-notes-row-text    { font-size:12px; color:var(--ink-gray-6); margin-top:2px; line-height:1.4; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; word-break:break-word; }

/* Validation dropdown panel */
.sn-dropdown-panel { position:fixed; z-index:8500; padding:4px; background:var(--surface-elevation-2); border:1px solid var(--outline-elevation-2); border-radius:8px; box-shadow:0 4px 12px rgba(0,0,0,.12); min-width:140px; max-height:240px; overflow-y:auto; }
.sn-dropdown-opt   { display:flex; align-items:center; gap:8px; padding:6px 10px; border-radius:6px; font-size:13px; color:var(--ink-gray-9); cursor:pointer; white-space:nowrap; }
.sn-dropdown-opt:hover { background:var(--surface-gray-2); }
.sn-dropdown-opt.is-active { font-weight:500; }
.sn-dropdown-check { width:14px; height:14px; flex-shrink:0; color:var(--ink-gray-7); }
.sn-dropdown-chip  { max-width:200px; padding:2px 10px; border-radius:999px; color:var(--ink-gray-9); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.sn-dropdown-clear .sn-dropdown-label { overflow:hidden; text-overflow:ellipsis; }
.sn-dropdown-clear { color:var(--ink-gray-6); border-top:1px solid var(--outline-gray-1); border-radius:0 0 6px 6px; margin-top:2px; padding-top:8px; }

/* Conditional format dialog rows */
.sn-form-stack  { display:flex; flex-direction:column; gap:12px; }
.sn-cf-fmt      { display:flex; flex-direction:row; align-items:center; gap:12px; }
.sn-cf-fmt-label { font-size:12px; color:var(--ink-gray-6); flex:1; }
.sn-cf-hint     { font-size:11px; color:var(--ink-gray-5); margin:0; line-height:1.4; }

/* Colour-scale stop pickers + gradient preview strip */
.sn-cf-scale          { display:flex; gap:12px; align-items:flex-end; }
.sn-cf-stop           { display:flex; flex-direction:column; gap:4px; font-size:11px; color:var(--ink-gray-6); }
.sn-cf-stop input     { width:32px; height:28px; padding:0; border:1px solid var(--outline-gray-2); border-radius:6px; cursor:pointer; }
.sn-cf-scale-preview  {
  height:18px; width:100%; border-radius:4px; border:1px solid var(--outline-gray-2);
}

/* Data-bar preview rows — three bars at sample widths so users can sanity-check the colour. */
.sn-cf-bar-preview    { display:flex; flex-direction:column; gap:4px; padding:6px; background:var(--surface-gray-1); border-radius:6px; border:1px solid var(--outline-gray-2); }
.sn-cf-bar-row        { height:14px; background:var(--surface-base); border-radius:3px; overflow:hidden; }
.sn-cf-bar-fill       { height:100%; opacity:.55; }

/* Existing-rules list at the top of the CF dialog. */
.sn-cf-rule-list       { display:flex; flex-direction:column; gap:4px; padding:8px; background:var(--surface-gray-1); border:1px solid var(--outline-gray-2); border-radius:6px; }
.sn-cf-rule-list-title { font-size:11px; font-weight:500; color:var(--ink-gray-6); text-transform:uppercase; letter-spacing:.04em; padding:2px 4px 4px; }
.sn-cf-rule-row        { display:flex; align-items:center; gap:4px; }
.sn-cf-rule-pick       { flex:1; text-align:left; font-size:12px; color:var(--ink-gray-8); background:var(--surface-base); border:1px solid var(--outline-gray-2); border-radius:5px; padding:6px 8px; cursor:pointer; }
.sn-cf-rule-pick:hover { background:var(--surface-gray-2); }
.sn-cf-rule-row--active .sn-cf-rule-pick { border-color:var(--ink-gray-9); }

</style>

<!-- Unscoped: frappe-ui's Dropdown teleports its menu to document.body, so
     a scoped rule never reaches it. This caps the menu height (and the
     inner content body Reka renders inside it) so long lists like the
     number-format picker stay scrollable instead of falling off-screen.
     frappe-ui beta.3 named the teleported menu `.dropdown-content`; beta.25
     (the version Suite ships) renamed it to `.menu-content` /
     `[data-reka-menu-content]`, so target every marker or the cap silently
     stops matching after a frappe-ui bump and the menu clips off-screen. -->
<style>
.dropdown-content,
.dropdown-content [data-slot=content-body],
.menu-content,
[data-reka-menu-content] {
  max-height: min(60vh, 480px);
  overflow-y: auto;
}
/* reka-ui teleports the popover to <body> (frappe-ui default z-index:50) with
   no marker we can target, so the slicer's column menu rendered behind the
   floating slicer (8400) / context menu (9000). Gate the bump on
   `body:has(.sn-slicer)` — only while a Sheets slicer is floating — so
   dropdowns everywhere else in the app (and other Suite products) keep their
   normal stacking. The doubled class still outranks the single-class default. */
body:has(.sn-slicer) .dropdown-content.dropdown-content,
body:has(.sn-slicer) .menu-content.menu-content { z-index: 9500; }

/* A Frappe UI Dialog draws a translucent (~12% black) scrim over the grid.
   The filter-range outline, pivot-output highlight, floating charts, and
   other canvas overlays sit above canvas content. Hide/suppress those
   decorations whenever a dialog is up. `.dialog-overlay` portals to
   <body>, so `:has` from body catches every open dialog modal. */
body:has(.dialog-overlay) .sn-filter-range,
body:has(.dialog-overlay) .sn-pivot-highlight,
body:has(.dialog-overlay) .sn-pivot-fab,
body:has(.dialog-overlay) .sn-remote-cursor,
body:has(.dialog-overlay) .sn-filter-overlay { display: none; }

body:has(.dialog-overlay) .co-layer {
  visibility: hidden !important;
  pointer-events: none !important;
}

/* Overlay scrollbars for the canvas grid. The elements are created imperatively
   in canvas/scrollbars.js (appended to .sn-grid-wrap), so they carry no scoped
   data-attr — these rules must live in the UNSCOPED block to reach them.
   z-index sits above the filter (14) / pivot (15) range outlines so the opaque
   track paints over any outline border that reaches the scrollbar gutter, but
   below the notes drawer (30) and popovers. */
.sn-sb          { position:absolute; z-index:16; background:var(--surface-gray-2, var(--surface-base));
                  border:0 solid var(--outline-gray-2);
                  opacity:1; transition:opacity .2s ease; }
/* --sn-sb-thick is published by canvas/scrollbars.js from SCROLLBAR_THICK, the
   single source of truth; the 12px fallback only covers the pre-mount frame. */
.sn-sb-v        { top:0; right:0; width:var(--sn-sb-thick, 12px); border-left-width:1px; }
.sn-sb-h        { left:0; bottom:0; height:var(--sn-sb-thick, 12px); border-top-width:1px; }
.sn-sb-corner   { position:absolute; z-index:16; right:0; bottom:0;
                  width:var(--sn-sb-thick, 12px); height:var(--sn-sb-thick, 12px);
                  background:var(--surface-gray-2, var(--surface-base));
                  border-left:1px solid var(--outline-gray-2);
                  border-top:1px solid var(--outline-gray-2);
                  opacity:1; transition:opacity .2s ease; }
/* Auto-hidden state — faded out and click-through so cells under the gutter
   stay reachable. JS (canvas/scrollbars.js) toggles this on inactivity. */
.sn-sb--hidden  { opacity:0; pointer-events:none; }
.sn-sb-thumb    { position:absolute; border-radius:6px; background:var(--ink-gray-4);
                  transition:background .12s ease; cursor:grab; touch-action:none; }
.sn-sb-v .sn-sb-thumb { top:0; left:2px; right:2px; }
.sn-sb-h .sn-sb-thumb { left:0; top:2px; bottom:2px; }
.sn-sb-thumb:hover           { background:var(--ink-gray-5); }
.sn-sb-dragging .sn-sb-thumb { background:var(--ink-gray-6); cursor:grabbing; }
.sn-sb-dragging              { cursor:grabbing; user-select:none; }
</style>
