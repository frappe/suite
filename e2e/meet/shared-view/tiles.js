// Presentation-only substitute: real video refs remain connected to VideoElementManager.
import {defineComponent,h} from 'vue';
export default defineComponent({
 props:['participant','videoRef','isLocal','count','pinType'],
 setup(props){return ()=>!props.participant ? h('div',{style:{padding:'20px',background:'#26384c'}},props.count?`+${props.count} hidden participants`:'') : h('div',{'data-participant':props.participant.user_id},[
  h('strong',{style:{position:'absolute',background:'#000b',color:'white',padding:'6px',zIndex:2}},props.pinType==='screenshare'?'Screen placeholder (fixture)':props.isLocal?'Local receiver (no camera)':props.participant.user_id),h('video',{ref:props.videoRef,autoplay:true,muted:true,playsinline:true,style:{width:'160px',height:'120px'}})
 ])}
});
