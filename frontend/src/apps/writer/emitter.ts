import mitt from 'mitt'

// A type, not an interface: mitt needs the implicit index signature, and an explicit one would accept typos
type WriterEvents = {
  'print-file': undefined
}

const emitter = mitt<WriterEvents>()
export default emitter
