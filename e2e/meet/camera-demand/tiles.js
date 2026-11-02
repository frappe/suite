// Presentation-only substitute: real video refs remain connected to VideoElementManager.
import {defineComponent,h} from 'vue';
export default defineComponent({
 props:['participant','videoRef','isLocal'],
 setup(props){return ()=>!props.participant ? h('div') : h('div',{'data-participant':props.participant.user_id},[
  h('video',{ref:props.videoRef,autoplay:true,muted:true,playsinline:true,style:{width:'160px',height:'120px'}})
 ])}
});
