    window.__hibanaPage = window.__hibanaPage || ((d) => (window.__hibanaPageQueue = window.__hibanaPageQueue || []).push(d))
    window.__hibanaPage({
      name: 'notifications',
      mount(ctx) {
        const _t = (k, f) => window.hibanaI18n?.t(k) || f
        // Fetch the JSON in parallel to build the summary chips (urgent/warning/info counts).
        // The htmx fragment loads the list; this just augments the header.
        fetch('/api/notifications').then((r) => r.ok ? r.json() : null).then((data) => {
          const summary = document.getElementById('notif-summary')
          if (!summary || !data || !data.notifications) return
          const urgent = data.notifications.filter((n) => n.severity === 'urgent').length
          const warning = data.notifications.filter((n) => n.severity === 'warning').length
          const info = data.notifications.filter((n) => n.severity === 'info').length
          if (!data.notifications.length) return
          summary.hidden = false
          summary.innerHTML = [
            urgent ? `<span class="notif-chip notif-urgent">${_t('notif.urgent','Urgent')}: ${urgent}</span>` : '',
            warning ? `<span class="notif-chip notif-warning">${_t('notif.warning','Soon')}: ${warning}</span>` : '',
            info ? `<span class="notif-chip notif-info">${_t('notif.info','Heads up')}: ${info}</span>` : '',
          ].join('')
        }).catch(() => {})
      },
    })
