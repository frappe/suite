import { createResource } from 'frappe-ui'
import { toast } from '@/apps/writer/utils'

export const exportBlog = async () => {
  toast('Starting export...')
  createResource({
    url: 'suite.writer.api.docs.create_blog',
    auto: true,
    params: {
      entity_name: props.id,
      html: editorValue.value.getHTML(),
    },
    onSuccess: (d) => {
      window.open('/app/blog-post/' + d)
    },
    onError: (error) => {
      toast({
        title: error.messages[0] || 'Could not export your document.',
        type: 'error',
      })
    },
  })
}
