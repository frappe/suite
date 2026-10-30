export * from "../../../frontend/recorder/frappeUi";
import { defineComponent, h } from "vue";
export const Tooltip = defineComponent({
  props: ["text"],
  setup(props, { slots }) {
    return () => h("span", { title: props.text }, slots.default?.());
  },
});
