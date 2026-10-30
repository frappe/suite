<template>
  <aside
    id="network-demo"
    style="
      position: fixed;
      right: 24px;
      bottom: 24px;
      z-index: 999;
      padding: 20px;
      background: #20232b;
      color: white;
      border-radius: 12px;
      font: 15px system-ui;
      min-width: 300px;
    "
  >
    <div style="font-size: 12px; color: #aab0be; margin-bottom: 12px">
      LOCAL RECEIVER · {{ before ? "BEFORE" : "AFTER" }}
    </div>
    <NetworkIndicator v-if="!before" :health="healthSnapshot" />
    <div v-else style="display: flex; align-items: center; gap: 8px">
      <WifiAlertIcon
        v-if="legacyQuality !== 'good'"
        style="width: 20px; height: 20px"
      />
      <span>{{
        legacyQuality === "good"
          ? "No network warning"
          : "Your internet connection is unstable. Video and audio might lag or drop."
      }}</span>
    </div>
    <div style="font-size: 12px; color: #aab0be; margin-top: 14px">
      {{ phase }}
    </div>
  </aside>
</template>
<script setup>
import { computed, shallowRef, ref } from "vue";
import { useNetworkQuality } from "../../../frontend/src/apps/meet/composables/useNetworkQuality";
import WifiAlertIcon from "../../../frontend/src/apps/meet/icons/WifiAlertIcon.vue";
import NetworkIndicator from "#network-indicator";
const props = defineProps(["manager", "before"]);
const health = useNetworkQuality(shallowRef(props.manager));
const phase = ref("Baseline");
const healthSnapshot = computed(() =>
  Object.fromEntries(Object.entries(health).map(([k, v]) => [k, v.value])),
);
// Original Meeting.vue combines only server quality, downlink and hard failure.
const legacyQuality = computed(() =>
  health.isTransportFailed.value ? "critical" : health.downlinkQuality.value,
);
window.networkDemo = {
  setPhase(value) {
    phase.value = value;
  },
  snapshot() {
    const indicator = document.querySelector(
      "#network-demo [data-network-status]",
    );
    const warning = indicator?.getAttribute("aria-label") || null;
    return {
      health: healthSnapshot.value,
      legacyQuality: legacyQuality.value,
      domStatus: indicator?.getAttribute("data-network-status") || null,
      text: props.before
        ? document.querySelector("#network-demo")?.innerText
        : "LOCAL RECEIVER · AFTER\n" +
          (warning || "No network warning") +
          "\n" +
          phase.value,
    };
  },
};
</script>
<style>
/* Presentation CSS for the isolated fixture; the product uses its existing utilities. */
#network-demo [data-network-status] {
  display: inline-flex;
  padding: 6px;
  border-radius: 9999px;
  background: #374151;
  box-shadow: 0 0 0 1px #1f2937;
}
#network-demo [data-network-status] svg {
  width: 16px;
  height: 16px;
  color: white;
}
</style>
