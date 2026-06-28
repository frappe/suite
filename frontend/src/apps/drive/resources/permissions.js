import { createResource } from 'frappe-ui'
import { toast } from '@/apps/drive/utils/toasts'
import { useSessionStore } from '@/boot/session'

export const usersWithAccess = createResource({
  url: 'suite.drive.api.permissions.get_shared_with_list',
  makeParams: (params) => params,
})

export const updateAccess = createResource({
  url: 'suite.drive.api.files.share',
  makeParams: (params) => ({ ...params, method: params.method || 'share' }),
  onError: (error) => toast({ type: 'error', title: error.messages[0] }),
})

export const notifCount = createResource({
  url: '/api/method/suite.drive.api.notifications.get_unread_count',
  method: 'GET',
  cache: 'notif-count',
})

export const settings = createResource({
  url: '/api/method/suite.drive.api.product.get_settings',
  method: 'GET',
  cache: 'settings',
})

export const setSettings = createResource({
  url: '/api/method/suite.drive.api.product.set_settings',
  method: 'POST',
  onSuccess: () => {
    settings.fetch()
  },
})

export const generalAccess = createResource({
  url: 'suite.drive.api.permissions.get_user_access',
})

export const userList = createResource({
  url: 'suite.drive.api.permissions.get_shared_with_list',
})

export const teamUsers = createResource({
  url: 'suite.drive.api.product.get_team_users',
  method: 'GET',
  transform: (data) => {
    data.map((item) => {
      item.value = item.email
      item.label = item.full_name.trimEnd()
    })
  },
})

export const getInvites = createResource({
  url: 'suite.drive.api.product.get_my_invites',
})

export const acceptInvite = createResource({
  url: 'suite.drive.api.product.accept_invite',
})

export const rejectInvite = createResource({
  url: 'suite.drive.api.product.reject_invite',
  onSuccess: () => toast('Removed invite'),
})

export const isAdmin = createResource({
  url: 'suite.drive.api.product.is_site_admin',
})

export const apps = createResource({
  url: 'frappe.apps.get_apps',
  cache: 'apps',
  transform: (data) => {
    let apps = [
      {
        name: 'frappe',
        logo: '/assets/frappe/images/framework.png',
        title: 'Desk',
        route: '/app',
      },
    ]
    data.map((app) => {
      if (app.name === 'drive') return
      apps.push({
        name: app.name,
        logo: app.logo,
        title: app.title,
        route: app.route,
      })
    })

    return apps
  },
})

export const diskSettings = createResource({
  url: 'suite.drive.api.product.disk_settings',
  method: 'GET',
  cache: 'disk-settings',
})

export const createTeam = createResource({
  url: 'suite.drive.api.product.create_team',
  makeParams: (params) => ({
    ...params,
    user: useSessionStore().user,
  }),
})

export const getDiskSettings = createResource({
  url: 'suite.drive.api.product.disk_settings',
  method: 'GET',
})
