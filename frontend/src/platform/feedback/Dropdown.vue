<script lang="ts">
/* eslint-disable vue/require-prop-types -- Frappe UI validates forwarded props; DropdownProps types the setup function. */
import { Dropdown as FrappeDropdown, type DropdownProps, type DropdownSlots } from 'frappe-ui'
import { defineComponent, h, useModel, type SlotsType } from 'vue'

import { useMenuActions } from './menuActions'

/** Preserve Frappe UI's menu contract while owning async action failures. */
export default defineComponent(
  (props: DropdownProps, { attrs, slots }) => {
    const open = useModel(props, 'open')
    const options = useMenuActions(() => props.options ?? [])
    return () =>
      h(
        FrappeDropdown,
        {
          ...attrs,
          ...props,
          open: open.value,
          options: options.value,
          'onUpdate:open': (value: boolean) => {
            open.value = value
          },
        },
        slots,
      )
  },
  {
    name: 'Dropdown',
    inheritAttrs: false,
    props: [
      'button',
      'options',
      'open',
      'align',
      'side',
      'offset',
      'matchTriggerWidth',
      'portalTo',
    ],
    emits: { 'update:open': (value: boolean) => typeof value === 'boolean' },
    // SAFETY: Vue's SlotsType is a compile-time brand; Object is its runtime
    // slot option, and setup forwards this Frappe UI slot contract unchanged.
    slots: Object as SlotsType<DropdownSlots>,
  },
)
</script>
