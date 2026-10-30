<script setup>
import { shallowRef, computed } from 'vue';
import { useMeetingContext } from '../../../frontend/src/apps/meet/composables/useMeetingContext';
import { useNetworkQuality } from '../../../frontend/src/apps/meet/composables/useNetworkQuality';
import FrappeMeetingLogo from '../../../frontend/src/apps/meet/icons/FrappeMeetingLogo.vue';
import ToolbarButton from '../../../frontend/src/apps/meet/components/ToolbarButton.vue';
import MeetMicOffIcon from '../../../frontend/src/apps/meet/icons/MeetMicOffIcon.vue';
import MeetCameraOffIcon from '../../../frontend/src/apps/meet/icons/MeetCameraOffIcon.vue';
import MeetPresentIcon from '../../../frontend/src/apps/meet/icons/MeetPresentIcon.vue';
import MeetHandIcon from '../../../frontend/src/apps/meet/icons/MeetHandIcon.vue';
import MeetSmileIcon from '../../../frontend/src/apps/meet/icons/MeetSmileIcon.vue';
import MeetMoreIcon from '../../../frontend/src/apps/meet/icons/MeetMoreIcon.vue';
import MeetPhoneOffIcon from '../../../frontend/src/apps/meet/icons/MeetPhoneOffIcon.vue';
import MeetPeopleIcon from '../../../frontend/src/apps/meet/icons/MeetPeopleIcon.vue';
import MeetChatIcon from '../../../frontend/src/apps/meet/icons/MeetChatIcon.vue';
import '#meet-demo-style';
const props=defineProps(['manager']);
const ctx=useMeetingContext();
const health=useNetworkQuality(shallowRef(props.manager));
ctx.networkHealth=health.health;
ctx.localNetworkQuality=health.networkQuality;
window.networkDemo = {
 setPhase() {},
 snapshot() {
  const indicator = document.querySelector('[data-testid="participant-tile-receiver"] [data-network-status]');
  return {health:health.health.value, domStatus:indicator?.getAttribute('data-network-status') || null};
 }
};
</script>
<template>
 <main data-theme="dark" class="fixed inset-0 flex flex-col bg-surface-base text-ink-gray-9">
  <header class="h-11 shrink-0 flex items-center px-4 gap-2"><FrappeMeetingLogo class="size-7 rounded-4"/><span class="text-base">Meet <span class="text-ink-gray-5 mx-2">/</span> Team catch-up</span><span id="phase-caption" class="ml-auto text-sm text-ink-gray-5">Healthy connection</span></header>
  <section class="flex-1 min-h-0 px-3 pb-2 flex"><slot/></section>
  <footer class="h-[3.75rem] shrink-0 grid grid-cols-[1fr_auto_1fr] items-center px-4">
   <div class="col-start-2 flex gap-1.5">
    <ToolbarButton title="Toggle Audio" variant="muted"><MeetMicOffIcon/></ToolbarButton>
    <ToolbarButton title="Toggle Video" variant="muted"><MeetCameraOffIcon/></ToolbarButton>
    <ToolbarButton title="Toggle Screen Share"><MeetPresentIcon/></ToolbarButton>
    <ToolbarButton title="Raise Hand"><MeetHandIcon/></ToolbarButton>
    <ToolbarButton title="Reactions"><MeetSmileIcon/></ToolbarButton>
    <ToolbarButton title="More options"><MeetMoreIcon/></ToolbarButton>
    <ToolbarButton title="End Call" variant="active"><MeetPhoneOffIcon/></ToolbarButton>
   </div>
   <div class="justify-self-end flex gap-1.5"><ToolbarButton title="Show Participants"><MeetPeopleIcon/></ToolbarButton><ToolbarButton title="Show Chat"><MeetChatIcon/></ToolbarButton></div>
  </footer>
 </main>
</template>
<style>
html,body,#app{margin:0;width:100%;height:100%;overflow:hidden}#app{height:100vh!important}
[data-testid="meeting-layout"]{height:100%!important;display:block!important}
[data-testid="meeting-layout"]>div{height:100%;display:flex;flex-wrap:wrap}
[data-testid="meeting-layout"] video{width:100%!important;height:100%!important}
</style>
