    // S87: two looks only — light + claude-dark (THE dark mode). Legacy 'dark' migrates.
    try {
      let t = localStorage.getItem('hibana-theme')
      if (t === 'dark') { try { localStorage.setItem('hibana-theme', 'claude-dark') } catch (e) {} ; t = 'claude-dark' }
      if (t !== 'light' && t !== 'claude-dark') t = matchMedia('(prefers-color-scheme: dark)').matches ? 'claude-dark' : 'light'
      document.documentElement.dataset.theme = t
    } catch (e) {}

    // Back button + a standalone theme-floater fallback (login.html keeps no app.js
    // either — this page owns its own minimal runtime).
    ;(function () {
      var back = document.getElementById('nf-back')
      if (back) back.addEventListener('click', function () {
        if (history.length > 1) history.back()   // somewhere to go → back
        else location.href = '/app'              // fresh tab → land on the dashboard
      })
      if (window.hibana) return
      var SUN = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
      var MOON = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>'
      var floater = document.querySelector('.theme-floater')
      function current() {
        var saved = null
        try { saved = localStorage.getItem('hibana-theme') } catch (e) {}
        if (saved === 'light') return 'light'
        if (saved === 'claude-dark' || saved === 'dark') return 'claude-dark'
        return matchMedia('(prefers-color-scheme: dark)').matches ? 'claude-dark' : 'light'
      }
      function paint() { if (floater) floater.innerHTML = current() === 'claude-dark' ? MOON : SUN }
      window.hibana = {
        toggleTheme: function () {
          var next = current() === 'claude-dark' ? 'light' : 'claude-dark'
          document.documentElement.dataset.theme = next
          try { localStorage.setItem('hibana-theme', next) } catch (e) {}
          paint()
          return next
        }
      }
      paint()
    })()
