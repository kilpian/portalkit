(function() {
  var API = 'https://portalkit-production.up.railway.app';
  var script = document.currentScript || (function() {
    var scripts = document.getElementsByTagName('script');
    return scripts[scripts.length - 1];
  })();
  var username = script.getAttribute('data-username');
  if (!username) return;

  var container = document.getElementById('portalkit-form');
  if (!container) return;

  fetch(API + '/api/lead/' + username)
    .then(function(r) { return r.json(); })
    .then(function(form) {
      if (!form || !form.active) return;
      var color = form.brand_color || '#1B4332';
      container.innerHTML = '<div style="font-family:system-ui,sans-serif;max-width:480px;background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:28px;box-shadow:0 2px 12px rgba(0,0,0,0.07);">' +
        '<h2 style="font-size:22px;font-weight:800;color:' + color + ';margin:0 0 6px;">' + esc(form.headline) + '</h2>' +
        (form.subheadline ? '<p style="font-size:14px;color:#6B7280;margin:0 0 20px;line-height:1.5;">' + esc(form.subheadline) + '</p>' : '') +
        '<div id="pk-error" style="display:none;background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;padding:10px 14px;font-size:13px;color:#DC2626;margin-bottom:12px;"></div>' +
        '<div id="pk-success" style="display:none;background:#ECFDF5;border:1px solid #A7F3D0;border-radius:8px;padding:16px;font-size:14px;font-weight:600;color:#059669;text-align:center;"></div>' +
        '<form id="pk-form" style="display:flex;flex-direction:column;gap:12px;">' +
        field('name', 'Full Name', 'text', 'Jane Smith', true) +
        field('email', 'Email', 'email', 'jane@example.com', false) +
        field('phone', 'Phone', 'tel', '+1 (555) 000-0000', false) +
        field('event_type', 'Event Type', 'text', 'Wedding, Portrait, Engagement…', false) +
        field('event_date', 'Event Date', 'date', '', false) +
        '<div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:6px;">Message</label><textarea name="message" placeholder="Tell us about your event…" rows="3" style="width:100%;padding:9px 12px;border:1px solid #D1D5DB;border-radius:8px;font-size:14px;box-sizing:border-box;resize:vertical;font-family:inherit;"></textarea></div>' +
        '<button type="submit" style="background:' + color + ';color:#fff;border:none;border-radius:8px;padding:12px 0;font-size:15px;font-weight:700;cursor:pointer;margin-top:4px;">Send Inquiry</button>' +
        '</form></div>';

      var el = function(id) { return document.getElementById(id); };
      el('pk-form').addEventListener('submit', function(e) {
        e.preventDefault();
        var data = {};
        var inputs = el('pk-form').querySelectorAll('input,textarea');
        for (var i = 0; i < inputs.length; i++) { data[inputs[i].name] = inputs[i].value; }
        if (!data.name || !data.name.trim()) {
          el('pk-error').style.display = 'block';
          el('pk-error').textContent = 'Your name is required.';
          return;
        }
        el('pk-error').style.display = 'none';
        var btn = el('pk-form').querySelector('button[type="submit"]');
        btn.disabled = true; btn.textContent = 'Sending...';
        fetch(API + '/api/lead/' + username + '/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        }).then(function(r) {
          if (r.ok) {
            el('pk-form').style.display = 'none';
            el('pk-success').style.display = 'block';
            el('pk-success').textContent = 'Thank you! Your inquiry has been submitted.';
          } else {
            btn.disabled = false; btn.textContent = 'Send Inquiry';
            el('pk-error').style.display = 'block';
            el('pk-error').textContent = 'Something went wrong. Please try again.';
          }
        }).catch(function() {
          btn.disabled = false; btn.textContent = 'Send Inquiry';
          el('pk-error').style.display = 'block';
          el('pk-error').textContent = 'Something went wrong. Please try again.';
        });
      });
    })
    .catch(function() {});

  function field(name, label, type, placeholder, required) {
    return '<div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:6px;">' + label + (required ? ' <span style="color:#DC2626;">*</span>' : '') + '</label><input type="' + type + '" name="' + name + '" placeholder="' + placeholder + '" ' + (required ? 'required' : '') + ' style="width:100%;padding:9px 12px;border:1px solid #D1D5DB;border-radius:8px;font-size:14px;box-sizing:border-box;"></div>';
  }

  function esc(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
})();
