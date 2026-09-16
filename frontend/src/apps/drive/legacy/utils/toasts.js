import { toast as fToast } from 'frappe-ui'
import { h } from 'vue'

const toast = (obj) => {
  if (typeof obj === 'string') return fToast.success(obj)
  const { title, buttons, icon, duration, type } = obj
  fToast.create({
    message: title,
    action: buttons?.[0],
    icon: icon && h(icon, { class: 'text-ink-base' }),
    duration: duration || 5,
    type,
  })
}
// passthrough: sonner's loading→success/error toast, updated in place by id
toast.promise = fToast.promise
export { toast }
