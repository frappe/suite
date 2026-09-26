<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue'
import { Button, Dropdown, FrappeUIProvider, TextInput, dialog, toast } from 'frappe-ui'
import { ChevronDown, ChevronUp, Copy, Eye, PenLine, Plus, Search, Trash, PanelsTopLeft } from 'lucide-vue-next'
import drawLogo from './assets/draw-logo.svg'
import SortControl from '@/components/SortControl.vue'
import { useAppSwitcher } from '@/composables/useAppSwitcher'
import { useSettingsMenuOption } from '@/composables/useSettingsMenuOption'
import { useThemeMenuOption } from '@/composables/useThemeMenuOption'
import { useSessionStore } from '@/boot/session'
import type { Scene, Shape } from './canvas/selection'
import { bounds, isLine } from './canvas/selection'
import { freeDrawPath } from './canvas/scene'

type Drawing = { name: string; title: string; content: string; creation: string; modified: string }
const drawings = ref<Drawing[]>([])
const loading = ref(true)
const loadFailed = ref(false)
const creating = ref(false)
const search = ref('')
const sortOrder = ref({ field: 'modified', label: 'Edited', ascending: false })
const sortFields = [
  { label: 'Title', field: 'title' },
  { label: 'Edited', field: 'modified' },
  { label: 'Created', field: 'creation' },
]
const preview = ref<Drawing | null>(null)
const csrf = ref('')
const session = useSessionStore()
const appsMenuOption = useAppSwitcher('draw')
const settingsMenuOption = useSettingsMenuOption()
const themeMenuOption = useThemeMenuOption()
const homeMenuOptions = computed(() => [
  { group: '', options: [appsMenuOption.value] },
  { group: '', options: [settingsMenuOption, themeMenuOption, { label: 'Log out', icon: 'lucide-log-out', onClick: () => session.logout.submit() }] },
])
const editorUrl = (name: string) => `/draw/editor?drawing=${encodeURIComponent(name)}`
const visible = computed(() => drawings.value.filter(d => d.title.toLowerCase().includes(search.value.toLowerCase())).sort((a, b) => {
  const field = sortOrder.value.field as 'modified' | 'creation' | 'title'
  const difference = a[field].localeCompare(b[field])
  return sortOrder.value.ascending ? difference : -difference
}))
const scene = (drawing: Drawing): Scene | null => {
  try {
    const value = typeof drawing.content === 'string' ? JSON.parse(drawing.content) : drawing.content
    return Array.isArray(value.rectangles) && Array.isArray(value.lines) ? value : null
  } catch { return null }
}
const shapes = (drawing: Drawing): Shape[] => {
  const value = scene(drawing)
  return value ? [...value.rectangles, ...value.lines].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)) : []
}
const viewBox = (drawing: Drawing) => {
  const box = bounds(shapes(drawing))
  if (!box) return '0 0 800 450'
  const width = Math.max(box.width * 1.35, box.height * 2.4, 200)
  const height = width * 9 / 16
  return `${box.x + box.width / 2 - width / 2} ${box.y + box.height / 2 - height / 2} ${width} ${height}`
}
const points = (shape: Shape) => {
  if (isLine(shape)) return ''
  return `${shape.x + shape.width / 2},${shape.y} ${shape.x + shape.width},${shape.y + shape.height / 2} ${shape.x + shape.width / 2},${shape.y + shape.height} ${shape.x},${shape.y + shape.height / 2}`
}
const kind = (shape: Shape): string => 'kind' in shape ? shape.kind : ''
const freePath = (shape: Shape) => kind(shape) === 'freedraw' ? freeDrawPath(shape as Extract<Shape, { kind: 'freedraw' }>) : ''
const imageSource = (shape: Shape) => kind(shape) === 'image' ? (shape as Extract<Shape, { kind: 'image' }>).src : ''
const textShape = (shape: Shape) => kind(shape) === 'text' ? shape as Extract<Shape, { kind: 'text' }> : null
const edited = (date: string) => {
  const days = Math.floor((Date.now() - new Date(date).getTime()) / 86400000)
  if (days < 1) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  if (days < 60) return 'a month ago'
  return `${Math.floor(days / 30)} months ago`
}
async function request(path: string, method = 'GET', body?: unknown) {
  try {
    const response = await fetch(path, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Frappe-CSRF-Token': csrf.value }, body: body === undefined ? undefined : JSON.stringify(body) })
    if (!response.ok) {
      const data = await response.json().catch(() => null)
      let message = data?.message
      try {
        message ||= JSON.parse(JSON.parse(data?._server_messages ?? '[]')[0] ?? '{}').message
      } catch { /* use the error type or status below */ }
      throw new Error(message || data?.exc_type || `Frappe returned HTTP ${response.status}`)
    }
    return method === 'DELETE' ? undefined : response.json()
  } catch (cause) {
    const networkError = cause instanceof TypeError
    toast.error(networkError ? 'Could not connect to Frappe' : 'Frappe request failed', { description: networkError ? 'Please check your connection and try again.' : cause instanceof Error ? cause.message : 'Please try again.' })
    throw cause
  }
}
async function refresh() {
  loading.value = true
  try {
    const data = await request('/api/resource/Drawing?fields=' + encodeURIComponent(JSON.stringify(['name', 'title', 'content', 'creation', 'modified'])) + '&limit_page_length=1000')
    drawings.value = data.data
    loadFailed.value = false
  } catch { loadFailed.value = true }
  finally { loading.value = false }
}
async function createDrawing() {
  if (creating.value) return
  creating.value = true
  try {
    const result = await request('/api/resource/Drawing', 'POST', { doctype: 'Drawing', title: 'Untitled Drawing', content: JSON.stringify({ rectangles: [], lines: [] }) })
    location.href = editorUrl(result.data.name)
  } catch { creating.value = false }
}
function rename(drawing: Drawing) {
  dialog.prompt({ title: 'Rename drawing', fields: [{ name: 'title', label: 'Title', required: true, defaultValue: drawing.title, validate: value => value.trim() ? null : 'Title is required' }], confirmLabel: 'Rename', onConfirm: async ({ values }) => {
    const title = values.title.trim()
    await request(`/api/resource/Drawing/${encodeURIComponent(drawing.name)}`, 'PUT', { title })
    drawing.title = title
  } })
}
async function duplicate(drawing: Drawing) {
  try {
    const copy = await request('/api/resource/Drawing', 'POST', { doctype: 'Drawing', title: `${drawing.title} Copy`, content: drawing.content })
    location.href = editorUrl(copy.data.name)
  } catch { /* request shows the toast */ }
}
function remove(drawing: Drawing) {
  dialog.confirm({
    title: 'Delete drawing',
    message: `"${drawing.title}" will be deleted.`,
    confirmLabel: 'Delete',
    theme: 'red',
    onConfirm: async () => {
      await request(`/api/resource/Drawing/${encodeURIComponent(drawing.name)}`, 'DELETE')
      drawings.value = drawings.value.filter(item => item.name !== drawing.name)
      if (preview.value?.name === drawing.name) preview.value = null
    },
  })
}
const menuOptions = (drawing: Drawing) => [
  { group: 'Actions', options: [
    { label: 'Rename', icon: h(PenLine, { class: 'stroke-[1.5] !size-3.5' }), onClick: () => rename(drawing) },
    { label: 'Duplicate', icon: h(Copy, { class: 'stroke-[1.5] !size-3.5' }), onClick: () => duplicate(drawing) },
    { label: 'Delete', icon: h(Trash, { class: 'stroke-[1.5] !size-3.5' }), onClick: () => remove(drawing) },
  ] },
  { group: 'Explore', options: [
    { label: 'Preview', icon: h(Eye, { class: 'stroke-[1.5] !size-3.5' }), onClick: () => { preview.value = drawing } },
  ] },
]
onMounted(async () => {
  csrf.value = (window as Window & { csrf_token?: string }).csrf_token ?? ''
  if (!csrf.value || csrf.value === '{{ csrf_token }}') {
    const desk = await fetch('/desk', { credentials: 'same-origin' }).then(r => r.text()).catch(() => '')
    csrf.value = desk.match(/frappe.csrf_token\s*=\s*["']([^"']+)/)?.[1] ?? ''
  }
  await refresh()
})
</script>

<template>
  <FrappeUIProvider>
  <div class="draw-home">
    <header class="home-navbar">
      <Dropdown :options="homeMenuOptions" :offset="16"><template #default="{ open }"><button class="home-brand" aria-label="Draw menu" :aria-expanded="open"><img :src="drawLogo" alt="Draw" /><ChevronUp v-if="open" class="w-4 stroke-[1.5] text-ink-gray-7" /><ChevronDown v-else class="w-4 stroke-[1.5] text-ink-gray-7" /></button></template></Dropdown>
      <Button variant="solid" label="New" :iconLeft="Plus" :disabled="creating" @click="createDrawing" />
    </header>
    <main class="home-content">
      <div class="home-controls">
        <h1 class="text-xl-semibold">Drawings</h1>
        <div class="home-filters">
          <TextInput v-if="drawings.length" v-model="search" placeholder="Search" aria-label="Search drawings" class="home-search"><template #prefix><Search :size="18" /></template></TextInput>
          <SortControl v-model="sortOrder" :options="sortFields" />
        </div>
      </div>
      <div v-if="visible.length" class="drawing-grid">
        <article v-for="drawing in visible" :key="drawing.name" class="drawing-card">
          <a class="drawing-thumbnail" :href="editorUrl(drawing.name)" :aria-label="`Open ${drawing.title}`">
            <svg v-if="shapes(drawing).length" class="drawing-art" :viewBox="viewBox(drawing)" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
              <g v-for="shape in shapes(drawing)" :key="shape.id" :opacity="shape.opacity ?? 1">
                <path v-if="isLine(shape)" :d="`M ${shape.start.x} ${shape.start.y} L ${shape.end.x} ${shape.end.y}`" fill="none" :stroke="shape.stroke || '#222'" :stroke-width="shape.strokeWidth ?? 2" />
                <path v-else-if="kind(shape) === 'freedraw'" :d="freePath(shape)" fill="none" :stroke="shape.stroke || '#222'" :stroke-width="shape.strokeWidth ?? 2" />
                <polygon v-else-if="kind(shape) === 'diamond'" :points="points(shape)" :fill="shape.fill || 'none'" :stroke="shape.stroke || '#222'" :stroke-width="shape.strokeWidth ?? 2" />
                <ellipse v-else-if="kind(shape) === 'ellipse'" :cx="shape.x + shape.width / 2" :cy="shape.y + shape.height / 2" :rx="shape.width / 2" :ry="shape.height / 2" :fill="shape.fill || 'none'" :stroke="shape.stroke || '#222'" :stroke-width="shape.strokeWidth ?? 2" />
                <image v-else-if="kind(shape) === 'image'" :href="imageSource(shape)" :x="shape.x" :y="shape.y" :width="shape.width" :height="shape.height" />
                <text v-else-if="kind(shape) === 'text'" :x="shape.x" :y="shape.y + (textShape(shape)?.fontSize ?? 16)" :font-size="textShape(shape)?.fontSize" :fill="shape.fill || '#222'">{{ textShape(shape)?.text }}</text>
                <rect v-else :x="shape.x" :y="shape.y" :width="shape.width" :height="shape.height" :rx="shape.cornerRadius" :fill="shape.fill || 'none'" :stroke="shape.stroke || '#222'" :stroke-width="shape.strokeWidth ?? 2" />
              </g>
            </svg>
            <svg v-else class="size-6 text-ink-gray-3" viewBox="15 15 70 70" fill="none" stroke="currentColor" stroke-width="7" aria-hidden="true">
              <path d="M26.5 26.5H66a7.5 7.5 0 0 1 7.5 7.5V66a7.5 7.5 0 0 1-7.5 7.5H34a7.5 7.5 0 0 1-7.5-7.5V38" stroke-linejoin="round" />
              <path d="M40 62c5-14 10-22 14-22 6 0 2 14 0 19-1 3 3 3 7-1" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </a>
          <div class="card-details"><div class="card-text"><div class="card-title">{{ drawing.title }}</div><div class="card-date">{{ sortOrder.field === 'creation' ? 'Created' : 'Edited' }} {{ edited(sortOrder.field === 'creation' ? drawing.creation : drawing.modified) }}</div></div>
            <Dropdown :options="menuOptions(drawing)" :button="{ icon: 'lucide-ellipsis', variant: 'ghost' }" align="end" />
          </div>
        </article>
      </div>
      <div v-else-if="loading" class="home-empty">Loading drawings…</div>
      <div v-else-if="loadFailed" class="home-empty"><Button label="Retry loading drawings" @click="refresh" /></div>
      <div v-else-if="search" class="home-empty">No drawings found</div>
      <div v-else class="home-empty"><PanelsTopLeft class="size-8 text-ink-gray-4" /><strong>No drawings yet.</strong><span>Add a new drawing to get started!</span><Button label="New Drawing" :disabled="creating" @click="createDrawing" /></div>
    </main>
    <div v-if="preview" class="preview-overlay" @click="preview = null"><div class="preview-dialog" @click.stop><button class="preview-close" @click="preview = null">Close</button><div class="preview-art"><svg :viewBox="viewBox(preview)"><g v-for="shape in shapes(preview)" :key="shape.id"><path v-if="isLine(shape)" :d="`M ${shape.start.x} ${shape.start.y} L ${shape.end.x} ${shape.end.y}`" fill="none" :stroke="shape.stroke || '#222'" :stroke-width="shape.strokeWidth ?? 2" /><path v-else-if="kind(shape) === 'freedraw'" :d="freePath(shape)" fill="none" :stroke="shape.stroke || '#222'" /><polygon v-else-if="kind(shape) === 'diamond'" :points="points(shape)" :fill="shape.fill || 'none'" :stroke="shape.stroke || '#222'" /><ellipse v-else-if="kind(shape) === 'ellipse'" :cx="shape.x + shape.width / 2" :cy="shape.y + shape.height / 2" :rx="shape.width / 2" :ry="shape.height / 2" :fill="shape.fill || 'none'" :stroke="shape.stroke || '#222'" /><image v-else-if="kind(shape) === 'image'" :href="imageSource(shape)" :x="shape.x" :y="shape.y" :width="shape.width" :height="shape.height" /><text v-else-if="kind(shape) === 'text'" :x="shape.x" :y="shape.y + (textShape(shape)?.fontSize ?? 16)" :font-size="textShape(shape)?.fontSize">{{ textShape(shape)?.text }}</text><rect v-else :x="shape.x" :y="shape.y" :width="shape.width" :height="shape.height" :fill="shape.fill || 'none'" :stroke="shape.stroke || '#222'" /></g></svg></div><h2>{{ preview.title }}</h2><a :href="editorUrl(preview.name)">Open drawing</a></div></div>
  </div>
  </FrappeUIProvider>
</template>

<style scoped>
.draw-home{height:100%;min-height:100vh;background:white;color:#171717;font-family:InterVar,Inter,ui-sans-serif,system-ui,sans-serif}
.home-navbar{height:48px;border-bottom:1px solid #ededed;display:flex;align-items:center;justify-content:space-between;padding:0 12px}
.home-brand{display:flex;align-items:center;gap:8px;border:0;background:transparent;cursor:pointer;color:inherit;padding:0}.home-brand img{width:28px;height:28px}
.home-navbar a{text-decoration:none}
.home-search{width:224px}
.home-content{width:100%;max-width:1088px;margin:0 auto;padding:32px}.home-controls{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:48px}.home-controls h1{margin:0}.home-filters{display:flex;gap:8px}.search-box{height:28px;width:224px;background:#f7f7f7;border-radius:8px;display:flex;align-items:center;gap:8px;padding:0 10px;color:#888}.search-box input{border:0;background:transparent;outline:0;font:inherit;font-size:14px;min-width:0;width:100%}.home-error{color:var(--ink-red-3,#b52a2a)}
:deep(.drawing-card button:focus:not(:focus-visible)){outline:none;box-shadow:none}
.drawing-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:32px}.drawing-card{min-width:0}.drawing-thumbnail{display:flex;align-items:center;justify-content:center;aspect-ratio:16/9;border:1px solid #e4e4e4;border-radius:6px;box-shadow:0 1px 4px #00000016;overflow:hidden;background:white;color:#aaa}.drawing-art{width:100%;height:100%}.card-details{display:flex;justify-content:space-between;align-items:start;padding-top:12px}.card-text{min-width:0}.card-title,.card-date{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:16px;line-height:20px}.card-title{color:#404040}.card-date{color:#737373;font-size:14px;line-height:18px}.card-menu{position:relative}.menu-trigger{border:0;background:transparent;border-radius:9px;padding:6px;cursor:pointer}.menu-trigger:hover{background:#eee}.menu-popover{position:absolute;right:0;top:40px;z-index:20;width:240px;padding:12px 0;background:white;border:1px solid #e1e1e1;border-radius:17px;box-shadow:0 15px 35px #0002}.menu-heading{padding:5px 20px;color:#888;font-size:16px}.menu-popover button{display:flex;align-items:center;gap:14px;width:100%;padding:8px 20px;border:0;background:white;text-align:left;color:#444;font:inherit;font-size:18px;cursor:pointer}.menu-popover button:hover{background:#f5f5f5}.menu-divider{border-top:1px solid #eee;margin:8px 0}.home-empty{min-height:300px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:#777}.home-empty strong{color:#444;font-size:20px}.home-empty a{margin-top:16px;color:#333}.preview-overlay{position:fixed;inset:0;z-index:50;background:#0005;display:grid;place-items:center}.preview-dialog{width:min(800px,90vw);padding:24px;background:white;border-radius:20px}.preview-close{float:right;border:0;background:transparent;cursor:pointer}.preview-art{aspect-ratio:16/9;border:1px solid #eee;margin-top:30px}.preview-art svg{width:100%;height:100%}
@media(max-width:650px){.home-content{padding:30px 20px}.home-controls{align-items:start;flex-direction:column;margin-bottom:35px}.search-box{width:min(100%,250px)}.drawing-grid{gap:28px}}
</style>
