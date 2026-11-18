/*
 * dsh-harness-gate — 注入到 DSH index.html 的浏览器运行时（脚本文本，非模块）。
 *
 * 硬约束：本文件在求值时绝不能抛异常；只用 kind:'script' 注入行的 textContent 方式执行。
 * 覆盖层挂 document.body（不进 #root，避免 hydrateRoot 内容不匹配）。
 *
 * 生物特征只保存在内存变量 template 中——不写 localStorage / 不写任何磁盘。
 * 页面关闭即消失（按用户"去掉本地人脸存储"的要求）。
 */
;(function (global) {
  'use strict'

  var NS = '__DSH_HARNESS_GATE__'
  if (global.__DSH_HARNESS_GATE_STARTED__ === true) return
  var cfg = global[NS]
  if (cfg === null || typeof cfg !== 'object') return
  if (typeof global.document !== 'object' || global.document === null) return
  global.__DSH_HARNESS_GATE_STARTED__ = true

  var doc = global.document
  var VERSION = cfg.version || '0.1.0'
  var assetBase = typeof cfg.assetBase === 'string' ? cfg.assetBase : '/dsh-harness-gate/asset/'
  if (assetBase.charAt(assetBase.length - 1) !== '/') assetBase += '/'
  var FILES = cfg.files || {}
  // 与 DSH 其他插件一致：route 用相对根路径，交给浏览器按当前 origin 解析
  // （桌面壳的 dsh-app:// 自定义协议同样按此规则命中 webServer 路由）。
  function assetUrl(rel) { return assetBase + rel }

  /* ---------------- DOM helpers (scoped to our root) ---------------- */
  var root = doc.createElement('div'); root.id = 'dshg-root'
  function $(id) { return root.querySelector('#' + id) }
  function el(tag, attrs, html) {
    var n = doc.createElement(tag)
    if (attrs) for (var k in attrs) { if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]) }
    if (html !== undefined) n.innerHTML = html
    return n
  }

  var RING_SVG =
    '<svg viewBox="0 0 400 400" aria-hidden="true">' +
      '<circle cx="200" cy="200" r="194" fill="none" stroke="rgba(0,229,255,.13)" stroke-width="1" stroke-dasharray="2 9"/>' +
      '<g class="dshg-ring"><circle cx="200" cy="200" r="172" fill="none" stroke="#00e5ff" stroke-width="1.3" stroke-dasharray="92 24 9 24" opacity=".85"/></g>' +
      '<g class="dshg-ring rev"><circle cx="200" cy="200" r="154" fill="none" stroke="#8b5cf6" stroke-width="1" stroke-dasharray="4 11" opacity=".75"/></g>' +
      '<circle cx="200" cy="200" r="128" fill="none" stroke="rgba(0,229,255,.18)" stroke-width="1"/>' +
      '<g stroke="#00e5ff" opacity=".6"><line x1="200" y1="4" x2="200" y2="20"/><line x1="200" y1="380" x2="200" y2="396"/>' +
      '<line x1="4" y1="200" x2="20" y2="200"/><line x1="380" y1="200" x2="396" y2="200"/></g>' +
    '</svg>'
  var GHOST_SVG =
    '<svg viewBox="0 0 200 260" aria-hidden="true">' +
      '<path d="M100 18 C52 18 33 66 35 116 C36 152 52 176 62 196 L68 232 Q100 250 132 232 L138 196 C148 176 164 152 165 116 C167 66 148 18 100 18 Z" fill="none" stroke="rgba(0,229,255,.5)" stroke-width="1.4"/>' +
      '<path d="M62 96 Q78 86 92 96 M108 96 Q122 86 138 96" fill="none" stroke="rgba(139,92,246,.7)" stroke-width="1.4"/>' +
      '<circle cx="77" cy="100" r="4" fill="rgba(0,229,255,.6)"/><circle cx="123" cy="100" r="4" fill="rgba(0,229,255,.6)"/>' +
      '<path d="M86 140 Q100 150 114 140" fill="none" stroke="rgba(0,229,255,.5)" stroke-width="1.4"/>' +
      '<path d="M100 30 V70 M100 70 L72 56 M100 70 L128 56" fill="none" stroke="rgba(0,229,255,.25)" stroke-width="1"/>' +
    '</svg>'

  var GATE_KEYS = ['faceCount', 'faceSize', 'faceConfidence', 'facingCenter', 'lookingCenter', 'blinkDetected', 'liveness', 'distance', 'descriptor']
  var GATE_LABEL = { faceCount: '单脸检测', faceSize: '面部尺寸', faceConfidence: '置信度', facingCenter: '正对镜头', lookingCenter: '注视镜头', blinkDetected: '眨眼活体', liveness: '活体微动', distance: '距离', descriptor: '特征向量' }
  var GATE_REQUIRED = ['faceCount', 'faceSize', 'faceConfidence', 'facingCenter', 'lookingCenter', 'distance', 'descriptor']
  var GATE_LIVENESS = ['blinkDetected', 'liveness']
  var OVAL = [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109]
  var EYE_L = [33,7,163,144,145,153,154,155,133,173,157,158,159,160,161,246]
  var EYE_R = [362,382,381,380,374,373,390,249,263,466,388,387,386,385,384,398]
  var BROW_L = [70,63,105,66,107,55,65,52,53,46]
  var BROW_R = [300,293,334,296,336,276,283,282,295,285]
  var LIPS_OUT = [61,40,37,0,267,270,291,321,314,17,84,91,181]
  var LIPS_IN = [78,80,81,82,13,14,87,178,88,95,96,77,97,86,171]
  var TEMPLATE_IDX = [1,33,133,362,263,61,291,152,10,168,6,197,195,5,4,45,275,123,352,162,21,54,103,67,109,127,234,93,58,132]
  var GATE_TIMEOUT = 30000

  /* ---------------- state ---------------- */
  var template = null            // 仅内存，不落盘
  var phase = 'boot'             // boot | setup | facegate | voice | unlocked
  var scanIntent = 'enroll'      // enroll | login
  var mode = 'face'
  var engine = null, engineReady = false, enginePromise = null, engineMode = '', delegate = 'CPU', rebuilds = 0
  var stream = null, scanning = false, raf = null, lastTs = 0, scan = null, lmRef = null
  var video, overlay, octx, viewport
  var gate = {}, gateLatch = {}, GATE_EL = {}
  var blink = { maxOpen: 0, phase: 'open', start: 0, done: false, dur: 0 }
  var motion = [], gateStart = 0, gateUiTs = 0, livenessGrace = false
  var selectedDeviceId = '', unlocked = false, voiceActive = false, vgRecog = null
  var checkEls = [], diag = { fps: 0, frames: 0, fpsT: 0, errs: 0, faces: 0 }
  GATE_KEYS.forEach(function (k) { gate[k] = { status: false, val: 0, hits: 0 }; gateLatch[k] = false })

  /* ---------------- build DOM ---------------- */
  try {
    root.innerHTML =
      '<canvas class="dshg-stars"></canvas><div class="dshg-nebula"></div><div class="dshg-nebula b"></div>' +
      '<div class="dshg-grid"></div><div class="dshg-vignette"></div>' +
      '<div class="dshg-glyphs"><span style="left:6%;top:18%">Ω-7749</span><span style="right:8%;top:26%">XENO//CORE</span>' +
      '<span style="left:10%;bottom:22%">478·PT</span><span style="right:12%;bottom:30%">IRIS 468-477</span></div>' +

      '<div class="dshg-boot" id="boot">' +
        '<div class="dshg-boot-ring"><i></i></div>' +
        '<div class="dshg-boot-title glitch" data-t="DEEPSEEK">DEEPSEEK</div>' +
        '<div class="dshg-boot-cn">深度求索</div>' +
        '<div class="dshg-boot-sub">XENO-CIVILIZATION ACCESS PROTOCOL · v' + VERSION + '</div>' +
        '<div class="dshg-boot-bar"><i id="bootBar"></i></div>' +
        '<div class="dshg-boot-stat" id="bootStat">INITIALIZING BIOMETRIC LINK...</div>' +
      '</div>' +

      '<div class="dshg-top">' +
        '<div class="dshg-brand"><span class="dshg-mark"></span> DEEPSEEK <em>深度求索</em></div>' +
        '<div class="dshg-top-right"><span class="dshg-clock" id="clock">--:--:-- UTC</span>' +
        '<span>BIOMETRIC ACCESS GATEWAY</span><button class="dshg-skip" id="skipBtn" title="跳过门禁直接进入 DSH">跳过门禁 / SKIP</button></div>' +
      '</div>' +

      /* setup workbench */
      '<div class="dshg-stage" id="stageSetup">' +
        '<div class="dshg-work">' +
          '<aside class="dshg-panel side"><h2><span></span>VISION ENGINE / 引擎</h2><div class="dshg-scroll">' +
            '<div class="dshg-kv"><span>ENGINE</span><b id="engState">OFFLINE</b></div>' +
            '<div class="dshg-kv"><span>DELEGATE</span><b id="engDelegate">--</b></div>' +
            '<div class="dshg-kv"><span>FEATURES</span><b>478PT + IRIS</b></div>' +
            '<div class="dshg-kv"><span>FPS</span><b id="fps">0</b></div>' +
            '<div class="dshg-kv"><span>DETECT ERR</span><b id="detectErr">0</b></div>' +
            '<div class="dshg-block"><label>ACQUISITION / 采集</label><div class="dshg-checks">' +
              ['ENGINE LINK','CAMERA FEED','FACE LOCK','MATCH / STORE','SESSION'].map(function(t){return '<div class="dshg-check"><span class="bx">·</span>'+t+'</div>'}).join('') +
            '</div></div>' +
            '<div class="dshg-block"><label>QUALITY GATE / 校验 <b id="gateCount">0 / 9</b></label><div class="dshg-qgate" id="qgate">' +
              GATE_KEYS.map(function(k){return '<div class="dshg-q" data-k="'+k+'"><span class="qn"><i class="qd"></i>'+GATE_LABEL[k]+'</span><span class="gv">--</span></div>'}).join('') +
            '</div></div>' +
          '</div></aside>' +

          '<div class="dshg-center">' +
            '<div class="dshg-scanner">' + RING_SVG +
              '<div class="dshg-viewport" id="viewport"><video id="video" autoplay playsinline muted></video>' +
                '<canvas id="overlay"></canvas><div class="dshg-ghost">' + GHOST_SVG + '</div>' +
                '<div class="dshg-facebox" id="facebox"></div><div class="dshg-iris" id="iris"></div>' +
                '<div class="dshg-laser" id="laser"></div><div class="dshg-pct" id="scanPct">00%</div>' +
              '</div>' +
            '</div>' +
            '<div class="dshg-mode" id="scanMode">AWAITING ENROLLMENT</div>' +
            '<div class="dshg-sub" id="scanSub">首次设置 · 点击右侧按钮录入人脸</div>' +
          '</div>' +

          '<aside class="dshg-panel auth"><h2><span></span>BIOMETRIC SETTINGS / 设置</h2><div class="dshg-scroll">' +
            '<div class="dshg-note" id="setNote">首次设置 · 请自主录入人脸信息（本次会话有效，不写入磁盘）</div>' +
            '<div class="dshg-seg"><button class="active" id="tabFace">FACE / 人脸</button><button id="tabIris">IRIS / 虹膜</button></div>' +
            '<div class="dshg-desc" id="modeDesc"><b>FACE RECOGNITION //</b> 真实摄像头采集 478 点面部拓扑，注册后以几何特征做本地 1:1 比对。</div>' +
            '<div class="dshg-field"><label>SUBJECT / 主体编号</label><input id="subject" type="text" placeholder="例如 OPERATOR-01" value="" spellcheck="false"></div>' +
            '<div class="dshg-field"><label>CAMERA / 摄像头</label><div class="dshg-camrow"><select id="camSelect"><option value="">默认摄像头 / DEFAULT</option></select><button id="camRefresh" title="刷新设备">⟳</button></div></div>' +
            '<div class="dshg-block"><label>STATUS / 状态</label><div class="dshg-kv"><span>TEMPLATE</span><b id="tplState">未注册 / NONE</b></div>' +
            '<div class="dshg-kv"><span>SESSION</span><b id="sessionState" class="warn">LOCKED</b></div></div>' +
            '<button class="dshg-btn" id="authBtn">◈ 录入人脸 / ENROLL</button>' +
            '<button class="dshg-btn ghost small" id="toGateBtn" style="display:none">→ 前往人脸识别 / FACE GATE</button>' +
            '<button class="dshg-btn ghost small" id="clearBtn">✕ 清除模板 / CLEAR</button>' +
            '<div class="dshg-block"><label>TRACE / 日志</label><div class="dshg-log" id="logWrap"></div></div>' +
          '</div></aside>' +
        '</div>' +
      '</div>' +

      /* face gate */
      '<div class="dshg-stage" id="stageGate">' +
        '<div class="dshg-gatewrap">' +
          '<div class="dshg-orbit">' + RING_SVG +
            '<div class="dshg-port" id="gatePort"></div><div class="dshg-pct on" id="fgPct" style="display:none">00%</div>' +
          '</div>' +
          '<div class="dshg-readout">' +
            '<div class="dshg-kicker">FACE RECOGNITION // 身份识别</div>' +
            '<div class="dshg-title glitch" data-t="IDENTITY SCAN">IDENTITY SCAN</div>' +
            '<div class="dshg-desc2">以本地 478 点面部拓扑与虹膜特征，与本次会话内注册的主体做 1:1 比对。通过后进入语音登录确认。</div>' +
            '<div class="dshg-status" id="fgStatus">点击启动 · 请正视摄像头完成人脸识别</div>' +
            '<div class="dshg-metrics"><div><span>置信度</span><b id="fgConf">--</b></div><div><span>校验项</span><b id="fgGateCount">0 / 9</b></div><div><span>主体</span><b id="fgSubject" style="font-size:13px">--</b></div></div>' +
            '<div class="dshg-gbar"><i id="fgGateBar"></i></div>' +
          '</div>' +
        '</div>' +
        '<div class="dshg-gactions">' +
          '<div class="dshg-camrow" style="width:100%"><select id="fgCamSelect"><option value="">默认摄像头 / DEFAULT</option></select><button id="fgCamRefresh" title="刷新设备">⟳</button></div>' +
          '<button class="dshg-btn" id="fgStart">◈ 启动人脸识别 / START SCAN</button>' +
          '<div class="dshg-note2">首次使用请先在“设置界面”录入人脸 · 识别通过后进行语音登录确认</div>' +
        '</div>' +
      '</div>' +

      /* voice */
      '<div class="dshg-stage" id="stageVoice"><div class="dshg-voicewrap">' +
        '<div class="dshg-vsig"><span>🎙</span></div>' +
        '<div class="dshg-kicker">VOICE AUTHENTICATION // 语音登录确认</div>' +
        '<div class="dshg-vtitle glitch" data-t="CONFIRM LOGIN">CONFIRM LOGIN</div>' +
        '<div class="dshg-vsub" id="vgSub">生物特征已验证 · 正在播报确认指令…</div>' +
        '<div class="dshg-wave" id="vgWave"></div>' +
        '<div class="dshg-vheard" id="vgHeard">等待语音指令…</div>' +
        '<div class="dshg-vactions">' +
          '<button class="dshg-btn" id="vgConfirm">✓ 确认登录 / CONFIRM</button>' +
          '<button class="dshg-btn ghost" id="vgMic">🎤 语音确认 / VOICE</button>' +
          '<button class="dshg-btn ghost" id="vgBack">↩ 返回识别 / BACK</button>' +
        '</div>' +
      '</div></div>' +

      '<div class="dshg-foot">DEEPSEEK HARNESS · BIOMETRIC GATE v' + VERSION + ' · 本地处理 · 生物特征仅存于内存</div>'

    video = $('video'); overlay = $('overlay'); octx = overlay.getContext('2d'); viewport = $('viewport')
    GATE_KEYS.forEach(function (k) { GATE_EL[k] = root.querySelector('.dshg-q[data-k="' + k + '"]') })
    checkEls = root.querySelectorAll('.dshg-check')
    $('vgWave').innerHTML = Array.apply(null, Array(34)).map(function () { return '<i></i>' }).join('')
  } catch (e) {
    // DOM 构建失败：直接放行，绝不挡住宿主应用
    try { root.style.display = 'none' } catch (e2) {}
    return
  }

  doc.body.appendChild(root)

  // 解锁后的"重新锁定"胶囊必须挂在 body 上（不能进 root，否则门禁淡出后它也一起消失）
  var lockPill = doc.createElement('button')
  lockPill.textContent = '🔒 重新锁定 / RE-LOCK'
  lockPill.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147482990;border:1px solid rgba(139,92,246,.5);background:rgba(10,4,24,.78);color:#8b5cf6;font:10px ui-monospace,monospace;letter-spacing:2px;padding:8px 12px;cursor:pointer;display:none'
  doc.body.appendChild(lockPill)

  /* ---------------- starfield ---------------- */
  try {
    var sc = root.querySelector('.dshg-stars'), sctx = sc.getContext('2d'), stars = []
    function resizeStars() {
      var dpr = Math.min(2, global.devicePixelRatio || 1)
      sc.width = Math.max(2, Math.round(global.innerWidth * dpr)); sc.height = Math.max(2, Math.round(global.innerHeight * dpr))
      stars = []
      var n = Math.min(180, Math.round(sc.width * sc.height / 9000))
      for (var i = 0; i < n; i++) stars.push({ x: Math.random() * sc.width, y: Math.random() * sc.height, r: Math.random() * 1.6 * dpr + .3, a: Math.random(), v: Math.random() * .02 + .005 })
    }
    function drawStars() {
      sctx.clearRect(0, 0, sc.width, sc.height)
      for (var i = 0; i < stars.length; i++) {
        var s = stars[i]; s.a += s.v; if (s.a > 1 || s.a < .1) s.v *= -1
        sctx.globalAlpha = Math.max(.05, Math.min(1, s.a)); sctx.fillStyle = i % 9 === 0 ? '#8b5cf6' : '#bfefff'
        sctx.beginPath(); sctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); sctx.fill()
      }
      sctx.globalAlpha = 1; global.requestAnimationFrame(drawStars)
    }
    resizeStars(); drawStars(); global.addEventListener('resize', resizeStars)
  } catch (e) {}

  /* ---------------- boot ---------------- */
  var bootTimer = setInterval(function () {
    var b = parseInt($('bootBar').style.width || '0', 10)
    b = Math.min(100, b + 4 + Math.random() * 7); $('bootBar').style.width = b + '%'
    if (b > 34) $('bootStat').textContent = 'LINKING VISION ENGINE...'
    if (b > 68) $('bootStat').textContent = 'CALIBRATING BIOMETRIC SENSORS...'
    if (b >= 100) {
      clearInterval(bootTimer)
      setTimeout(function () {
        var bt = $('boot'); bt.classList.add('off')
        setTimeout(function () { bt.style.display = 'none' }, 650)
        enterPhase(template ? 'facegate' : 'setup')
      }, 380)
    }
  }, 90)

  try { setInterval(function () { $('clock').textContent = new Date().toISOString().slice(11, 19) + ' UTC' }, 1000) } catch (e) {}

  /* ---------------- logging ---------------- */
  function log(msg, cls) {
    try {
      var w = $('logWrap'); if (!w) return
      var d = doc.createElement('div'); d.className = cls || ''; d.textContent = '› ' + String(msg).replace(/<[^>]*>/g, '')
      w.appendChild(d); while (w.children.length > 40) w.removeChild(w.firstChild); w.scrollTop = w.scrollHeight
    } catch (e) {}
  }

  /* ---------------- engine ---------------- */
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = doc.createElement('script'); s.src = src; s.async = true
      s.onload = function () { resolve() }
      s.onerror = function () { reject(new Error('bundle load failed: ' + src)) }
      ;(doc.head || doc.body).appendChild(s)
    })
  }
  function ensureVision() {
    if (global.Vision && global.Vision.FaceLandmarker && global.Vision.FilesetResolver) return Promise.resolve(global.Vision)
    return loadScript(assetUrl(FILES.bundle || 'vision_bundle.js')).then(function () {
      if (!global.Vision || !global.Vision.FaceLandmarker) throw new Error('Vision global unavailable')
      return global.Vision
    })
  }
  function initEngine() {
    if (engineReady) return Promise.resolve(true)
    if (enginePromise) return enginePromise
    enginePromise = ensureVision().then(function (V) {
      var wasmPath = assetUrl('wasm')
      var modelPath = assetUrl(FILES.model || 'face_landmarker.task')
      return V.FilesetResolver.forVisionTasks(wasmPath).then(function (fileset) {
        var opts = {
          baseOptions: { modelAssetPath: modelPath, delegate: delegate },
          runningMode: 'VIDEO', numFaces: 1,
          outputFaceBlendshapes: false, outputFacialTransformationMatrixes: false
        }
        return V.FaceLandmarker.createFromOptions(fileset, opts)
      }).then(function (eng) {
        engine = eng; engineReady = true; engineMode = 'LOCAL'
        try { $('engState').textContent = 'ONLINE'; $('engState').className = 'ok'; $('engDelegate').textContent = delegate } catch (e) {}
        log('Vision engine ONLINE · LOCAL / ' + delegate + ' · 478pt + iris', 'ok')
        return true
      })
    }).catch(function (e) {
      engineReady = false
      try { $('engState').textContent = 'OFFLINE'; $('engState').className = 'err' } catch (e2) {}
      log('Engine failed · ' + String(e && e.message || e).slice(0, 60), 'err')
      return false
    }).then(function (v) { enginePromise = null; return v })
    return enginePromise
  }
  function rebuildEngine(reason) {
    if (rebuilds >= 3) return
    rebuilds++; engineReady = false
    delegate = delegate === 'CPU' ? 'GPU' : 'CPU'
    try { engine && engine.close && engine.close() } catch (e) {}
    engine = null
    log('Rebuild engine (' + reason + ') → ' + delegate, 'warn')
    initEngine()
  }

  /* ---------------- camera ---------------- */
  function listCameras(quiet) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return Promise.resolve()
    return navigator.mediaDevices.enumerateDevices().then(function (devices) {
      var cams = devices.filter(function (d) { return d.kind === 'videoinput' })
      var prev = selectedDeviceId
      var html = '<option value="">默认摄像头 / DEFAULT</option>'
      cams.forEach(function (d, i) { html += '<option value="' + d.deviceId + '">' + (d.label || ('CAMERA ' + (i + 1))) + '</option>' })
      $('camSelect').innerHTML = html; $('fgCamSelect').innerHTML = html
      if (prev) { try { $('camSelect').value = prev; $('fgCamSelect').value = prev } catch (e) {} }
      selectedDeviceId = $('camSelect').value || ''
      if (!quiet) log('Sensors enumerated · ' + cams.length + ' found', 'ok')
    }).catch(function (e) { if (!quiet) log('Enumerate failed · ' + e.name, 'err') })
  }
  function videoConstraints(id) {
    if (!id) return { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }
    return { deviceId: { exact: id }, width: { ideal: 1280 }, height: { ideal: 720 } }
  }
  function stopCamera() {
    try { if (stream) { stream.getTracks().forEach(function (t) { try { t.stop() } catch (e) {} }); stream = null } } catch (e) {}
    try { video.srcObject = null } catch (e) {}
    viewport.classList.remove('live')
  }
  function startCamera(id) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      log('getUserMedia unavailable · 需要 localhost 或 https', 'err'); return Promise.resolve(false)
    }
    stopCamera()
    return navigator.mediaDevices.getUserMedia({ video: videoConstraints(id), audio: false }).then(function (s) {
      stream = s; video.srcObject = s
      return new Promise(function (resolve) {
        if (video.readyState >= 2) return resolve(true)
        var done = false
        var fin = function () { if (done) return; done = true; resolve(true) }
        video.onloadedmetadata = fin; video.onplaying = fin
        try { video.play() } catch (e) {}
        setTimeout(fin, 2500)
      })
    }).then(function () {
      viewport.classList.add('live')
      selectedDeviceId = id || ''
      try { $('camSelect').value = id || ''; $('fgCamSelect').value = id || '' } catch (e) {}
      log('Camera online · ' + (video.videoWidth || 0) + '×' + (video.videoHeight || 0), 'ok')
      return true
    }).catch(function (e) {
      log('Camera error · ' + (e && e.name || e), 'err'); return false
    })
  }
  function switchCamera(id) {
    if (!stream) { selectedDeviceId = id || ''; return Promise.resolve(true) }
    return startCamera(id).then(function (ok) {
      if (!ok) { selectedDeviceId = ''; try { $('camSelect').value = ''; $('fgCamSelect').value = '' } catch (e) {} }
      return ok
    })
  }
  function applyCamChoice(id) {
    selectedDeviceId = id || ''
    try { $('camSelect').value = id || ''; $('fgCamSelect').value = id || '' } catch (e) {}
    switchCamera(id)
  }

  /* ---------------- geometry / vectors ---------------- */
  function sizeOverlay() {
    var dpr = Math.min(2, global.devicePixelRatio || 1)
    overlay.width = Math.max(2, Math.round(viewport.clientWidth * dpr))
    overlay.height = Math.max(2, Math.round(viewport.clientHeight * dpr))
  }
  function coverMapping() {
    var vw = video.videoWidth || 1280, vh = video.videoHeight || 720
    var w = overlay.width, h = overlay.height
    var scale = Math.max(w / vw, h / vh), sx = vw * scale, sy = vh * scale
    return { w: w, h: h, sx: sx, sy: sy, ox: (w - sx) / 2, oy: (h - sy) / 2 }
  }
  function project(lm, i, m) { var p = lm[i]; return { x: m.ox + (1 - p.x) * m.sx, y: m.oy + p.y * m.sy } }
  function poly(ctx, pts, color, alpha, width) {
    ctx.strokeStyle = color; ctx.globalAlpha = alpha; ctx.lineWidth = width; ctx.beginPath()
    pts.forEach(function (p, i) { i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y) }); ctx.closePath(); ctx.stroke()
  }
  function drawMesh(lm) {
    var m = coverMapping(), s = overlay.width / (viewport.clientWidth || 1)
    octx.clearRect(0, 0, overlay.width, overlay.height)
    var chain = function (arr) { return arr.map(function (i) { return project(lm, i, m) }) }
    poly(octx, chain(OVAL), '#00e5ff', .85, 1.4 * s)
    poly(octx, chain(EYE_L), '#00e5ff', .95, 1.4 * s); poly(octx, chain(EYE_R), '#00e5ff', .95, 1.4 * s)
    poly(octx, chain(BROW_L), '#8b5cf6', .7, 1.2 * s); poly(octx, chain(BROW_R), '#8b5cf6', .7, 1.2 * s)
    poly(octx, chain(LIPS_OUT), '#8b5cf6', .75, 1.2 * s); poly(octx, chain(LIPS_IN), '#8b5cf6', .55, 1 * s)
    octx.fillStyle = '#00e5ff'
    for (var i = 0; i < lm.length; i += 3) { var p = project(lm, i, m); octx.globalAlpha = .4; octx.fillRect(p.x - s * .7, p.y - s * .7, 1.4 * s, 1.4 * s) }
    ;[468, 473].forEach(function (n, k) {
      if (!lm[n]) return
      var c = project(lm, n, m), edge = project(lm[n + 1] || n, m)
      var r = Math.max(5 * s, Math.hypot(edge.x - c.x, edge.y - c.y))
      octx.globalAlpha = .95; octx.strokeStyle = k ? '#ffb020' : '#00e5ff'; octx.lineWidth = 1.4 * s
      octx.beginPath(); octx.arc(c.x, c.y, r, 0, Math.PI * 2); octx.stroke()
      octx.beginPath(); octx.moveTo(c.x - r * 1.5, c.y); octx.lineTo(c.x + r * 1.5, c.y); octx.moveTo(c.x, c.y - r * 1.5); octx.lineTo(c.x, c.y + r * 1.5); octx.stroke()
    })
    octx.globalAlpha = 1
  }
  function faceBounds(lm, m) {
    var pts = OVAL.map(function (i) { return project(lm, i, m) })
    var xs = pts.map(function (p) { return p.x }), ys = pts.map(function (p) { return p.y })
    return { minX: Math.min.apply(null, xs), maxX: Math.max.apply(null, xs), minY: Math.min.apply(null, ys), maxY: Math.max.apply(null, ys) }
  }
  function geoVector(lm) {
    var nose = lm[1], le = lm[33], re = lm[263]
    var den = Math.max(1e-4, Math.hypot(re.x - le.x, re.y - le.y))
    return TEMPLATE_IDX.map(function (i) { return [+((lm[i].x - nose.x) / den).toFixed(4), +((lm[i].y - nose.y) / den).toFixed(4)] }).reduce(function (a, b) { return a.concat(b) }, [])
  }
  function irisVector(lm, which) {
    var b = which === 'L' ? 468 : 473, c = lm[b]; if (!c) return null
    var vw = video.videoWidth || 1280, vh = video.videoHeight || 720, rad = 0
    for (var i = 1; i <= 4; i++) { var p = lm[b + i]; if (p) rad += Math.hypot((p.x - c.x) * vw, (p.y - c.y) * vh) / 4 }
    rad = Math.max(6, rad)
    var outIdx = which === 'L' ? 33 : 263, innIdx = which === 'L' ? 133 : 362
    var o = lm[outIdx], inn = lm[innIdx]
    var ang = o && inn ? Math.atan2((o.y - inn.y) * vh, (o.x - inn.x) * vw) : 0
    var cvs = doc.createElement('canvas'); cvs.width = 48; cvs.height = 48
    var c2 = cvs.getContext('2d'); c2.fillStyle = '#000'; c2.fillRect(0, 0, 48, 48)
    c2.save(); c2.translate(24, 24); c2.rotate(-ang)
    try { c2.drawImage(video, c.x * vw - rad * 1.3, c.y * vh - rad * 1.3, rad * 2.6, rad * 2.6, -24, -24, 48, 48) } catch (e) {}
    c2.restore()
    var d = c2.getImageData(0, 0, 48, 48).data, vec = [], sum = 0
    for (var j = 0; j < d.length; j += 4) { var g = d[j] * .3 + d[j + 1] * .59 + d[j + 2] * .11; vec.push(g); sum += g }
    var mean = sum / vec.length
    return vec.map(function (g) { return +((g - mean) / 45).toFixed(3) })
  }
  function cosine(a, b) {
    if (!a || !b || a.length !== b.length) return 0
    var dot = 0, na = 0, nb = 0
    for (var i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
    return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1)
  }
  function matchScore(lm) {
    var g = cosine(geoVector(lm), template.geo)
    if (mode === 'iris') {
      var a = irisVector(lm, 'L'), b = irisVector(lm, 'R')
      var ia = a && template.irisL ? cosine(a, template.irisL) : 0
      var ib = b && template.irisR ? cosine(b, template.irisR) : 0
      return { score: g * .45 + Math.max(ia, ib) * .55, geo: g, iris: Math.max(ia, ib) }
    }
    return { score: g, geo: g, iris: 0 }
  }

  /* ---------------- quality gate ---------------- */
  function dist2(a, b, vw, vh) { return Math.hypot((a.x - b.x) * vw, (a.y - b.y) * vh) }
  function resetGate() {
    GATE_KEYS.forEach(function (k) {
      gate[k].status = false; gate[k].val = 0; gate[k].hits = 0; gateLatch[k] = false
      if (GATE_EL[k]) { GATE_EL[k].classList.remove('ok', 'pending'); GATE_EL[k].querySelector('.gv').textContent = '--' }
    })
    blink = { maxOpen: 0, phase: 'open', start: 0, done: false, dur: 0 }
    motion = []; gateStart = global.performance.now(); gateUiTs = 0; livenessGrace = false; lmRef = null
    try { $('gateCount').textContent = '0 / 9' } catch (e) {}
  }
  function evaluateGate(lm, faces, q, vw, vh, ts) {
    gate.faceCount.val = faces.length; gate.faceCount.status = faces.length === 1
    var fw = Math.abs(lm[454].x - lm[234].x) || Math.abs(lm[263].x - lm[33].x)
    var fh = Math.abs(lm[152].y - lm[10].y)
    gate.faceSize.val = fw; gate.faceSize.status = fw >= .10 && fw <= .95 && fh >= .12
    gate.faceConfidence.val = q; gate.faceConfidence.status = q >= .55
    var dLR = Math.max(1e-4, dist2(lm[234], lm[454], vw, vh))
    var yaw = (dist2(lm[1], lm[234], vw, vh) - dist2(lm[1], lm[454], vw, vh)) / dLR
    var dTB = Math.max(1e-4, dist2(lm[10], lm[152], vw, vh))
    var pitch = (dist2(lm[168], lm[10], vw, vh) - dist2(lm[168], lm[152], vw, vh)) / dTB
    var roll = ((lm[454].y - lm[234].y) * vh) / dLR
    var pitchOff = pitch + 0.46
    gate.facingCenter.val = Math.max(Math.abs(yaw), Math.abs(pitchOff), Math.abs(roll))
    gate.facingCenter.status = Math.abs(yaw) < .20 && Math.abs(pitchOff) < .32 && Math.abs(roll) < .22
    var gaze = function (ic, o, i, t, b) {
      if (!lm[ic] || !lm[o] || !lm[i] || !lm[t] || !lm[b]) return 9
      var cx = (lm[o].x + lm[i].x) / 2, cy = (lm[t].y + lm[b].y) / 2
      return Math.max(Math.abs((lm[ic].x - cx) / Math.max(.01, Math.abs(lm[o].x - lm[i].x))), Math.abs((lm[ic].y - cy) / Math.max(.01, Math.abs(lm[t].y - lm[b].y))))
    }
    var gz = Math.min(gaze(468, 33, 133, 159, 145), gaze(473, 362, 263, 386, 374))
    gate.lookingCenter.val = gz; gate.lookingCenter.status = gz < .38
    var gapE = function (a, b) { return lm[a] && lm[b] ? Math.abs(lm[a].y - lm[b].y) : 0 }
    var open = Math.max(gapE(159, 145), gapE(386, 374))
    blink.maxOpen = Math.max(open, blink.maxOpen * .995)
    var cT = Math.max(.0012, blink.maxOpen * .35), oT = Math.max(.0024, blink.maxOpen * .58)
    if (blink.phase === 'open' && open < cT) { blink.phase = 'closed'; blink.start = ts }
    else if (blink.phase === 'closed' && open > oT) { blink.phase = 'open'; blink.dur = Math.round(ts - blink.start); if (blink.dur >= 10 && blink.dur <= 800) blink.done = true }
    gate.blinkDetected.val = blink.done ? blink.dur : 0; gate.blinkDetected.status = blink.done
    motion.push({ x: lm[1].x, y: lm[1].y }); if (motion.length > 40) motion.shift()
    var mv = 0
    if (motion.length > 8) {
      var mx = motion.reduce(function (s, p) { return s + p.x }, 0) / motion.length
      var my = motion.reduce(function (s, p) { return s + p.y }, 0) / motion.length
      mv = motion.reduce(function (s, p) { return s + Math.abs(p.x - mx) + Math.abs(p.y - my) }, 0) / motion.length
    }
    gate.liveness.val = mv; gate.liveness.status = blink.done || mv > .0008
    var dCm = 12.1 / Math.max(.02, fw)
    gate.distance.val = Math.round(dCm); gate.distance.status = dCm >= 25 && dCm <= 120
    gate.descriptor.val = geoVector(lm).length
    gate.descriptor.status = gate.descriptor.val > 0 && (mode !== 'iris' || !!(lm[468] && lm[473]))
    GATE_KEYS.forEach(function (k) {
      if (gate[k].status) { gate[k].hits = (gate[k].hits || 0) + 1; var need = (k === 'blinkDetected' || k === 'liveness') ? 1 : 2; if (gate[k].hits >= need) gateLatch[k] = true }
      else gate[k].hits = 0
    })
  }
  function updateGateUI(ts) {
    if (ts - gateUiTs < 160) return; gateUiTs = ts
    var pass = 0
    GATE_KEYS.forEach(function (k) {
      var node = GATE_EL[k], g = gate[k]; if (!node) return
      var passed = !!gateLatch[k]
      node.classList.toggle('ok', passed); if (passed) node.classList.remove('pending')
      var txt = '--'
      if (k === 'faceCount') txt = String(g.val)
      else if (k === 'faceSize' || k === 'faceConfidence') txt = Math.round(g.val * 100) + '%'
      else if (k === 'distance') txt = Math.round(g.val) + 'cm'
      else if (k === 'blinkDetected') txt = g.status ? g.dur + 'ms' : 'BLINK'
      else if (k === 'descriptor') txt = g.val + 'd'
      else txt = g.status ? 'OK' : '···'
      node.querySelector('.gv').textContent = txt
      if (passed) pass++
    })
    try { $('gateCount').textContent = pass + ' / 9' } catch (e) {}
    if (scanFromGate) {
      try { $('fgGateCount').textContent = pass + ' / 9'; $('fgGateBar').style.width = (pass / 9 * 100) + '%' } catch (e) {}
    }
  }
  function gateRequiredOk() { return GATE_REQUIRED.every(function (k) { return gateLatch[k] }) }
  function gatePending() {
    var p = GATE_REQUIRED.filter(function (k) { return !gateLatch[k] }).map(function (k) { return GATE_LABEL[k] })
    if (!livenessGrace) p = p.concat(GATE_LIVENESS.filter(function (k) { return !gateLatch[k] }).map(function (k) { return GATE_LABEL[k] }))
    return p
  }

  /* ---------------- scan phases ---------------- */
  var scanFromGate = false
  function mountViewport(toGate) {
    var port = $('gatePort'), home = viewport.parentNode
    if (toGate) { if (viewport.parentNode !== port) port.appendChild(viewport) }
    else {
      var center = root.querySelector('#stageSetup .dshg-scanner')
      if (center && viewport.parentNode !== center) center.appendChild(viewport)
    }
    setTimeout(sizeOverlay, 30)
  }
  function setCheck(i, cls) {
    var c = checkEls[i]; if (!c) return
    c.classList.remove('active', 'ok', 'err'); c.classList.add(cls)
    c.querySelector('.bx').textContent = cls === 'ok' ? '✓' : cls === 'err' ? '✕' : '›'
  }
  function resetChecks() {
    for (var i = 0; i < checkEls.length; i++) { checkEls[i].classList.remove('active', 'ok', 'err'); checkEls[i].querySelector('.bx').textContent = '·' }
  }
  function enterPhase(p) {
    phase = p; scanIntent = (p === 'setup') ? 'enroll' : 'login'
    stopScanSession(); stopVoice()
    try { $('stageSetup').classList.remove('on'); $('stageGate').classList.remove('on'); $('stageVoice').classList.remove('on') } catch (e) {}
    try { $('authBtn').disabled = false; $('fgStart').disabled = false; $('fgStart').textContent = '◈ 启动人脸识别 / START SCAN' } catch (e) {}
    if (p === 'setup') {
      var first = !template
      try {
        $('setNote').textContent = first ? '首次设置 · 请自主录入人脸信息（本次会话有效，不写入磁盘）' : '已登录 · 可在此重新录入 / 管理生物模板'
        $('setNote').className = 'dshg-note' + (first ? '' : ' locked')
        $('authBtn').textContent = '◈ 录入人脸 / ENROLL'
        $('toGateBtn').style.display = template ? '' : 'none'
        $('tplState').textContent = template ? ('已注册 · ' + (template.subject || 'UNKNOWN')) : '未注册 / NONE'
        $('tplState').className = template ? 'ok' : 'err'
        $('sessionState').textContent = unlocked ? 'UNLOCKED' : 'LOCKED'
        $('sessionState').className = unlocked ? 'ok' : 'warn'
        $('scanMode').textContent = 'AWAITING ENROLLMENT'
        $('scanSub').textContent = first ? '首次注册 · 点击右侧按钮录入人脸' : '可在设置中重新录入人脸'
      } catch (e) {}
      mountViewport(false); $('stageSetup').classList.add('on')
      log('Screen → SETTINGS · ' + (first ? '首次自主设置' : '已验证身份'), 'ok')
    } else if (p === 'facegate') {
      if (!template) { enterPhase('setup'); return }
      try {
        $('fgSubject').textContent = template.subject || 'UNKNOWN'
        fgStatus('点击启动 · 请正视摄像头完成人脸识别', '')
      } catch (e) {}
      $('stageGate').classList.add('on'); mountViewport(true)
      log('Screen → FACE RECOGNITION GATE', 'ok')
    } else if (p === 'voice') {
      $('stageVoice').classList.add('on')
      log('Screen → VOICE CONFIRMATION', 'ok')
    } else if (p === 'unlocked') {
      // 门禁通过：淡出并移除覆盖层，把 DSH 交还给用户
      try {
        $('stageSetup').classList.remove('on'); $('stageGate').classList.remove('on'); $('stageVoice').classList.remove('on')
        lockPill.style.display = 'block'
      } catch (e) {}
      root.classList.add('done')
      setTimeout(function () { root.classList.add('hidden') }, 950)
      log('⟪ ACCESS GRANTED ⟫ DEEPSEEK HARNESS unlocked', 'ok')
    }
  }
  function fgStatus(text, cls) { try { var e = $('fgStatus'); e.textContent = text; e.className = 'dshg-status' + (cls ? ' ' + cls : '') } catch (e2) {} }
  function stopScanSession() {
    if (raf) { global.cancelAnimationFrame(raf); raf = null }
    scanning = false; scan = null; stopCamera()
    try { $('facebox').classList.remove('on'); $('iris').classList.remove('on'); $('laser').classList.remove('on'); $('scanPct').classList.remove('on'); $('fgPct').style.display = 'none' } catch (e) {}
    try { octx.clearRect(0, 0, overlay.width, overlay.height); $('scanPct').textContent = '00%' } catch (e) {}
    resetChecks(); resetGate()
  }
  function beginScan(intent) {
    if (scanning) return
    scanIntent = intent; scanFromGate = (intent === 'login')
    if (scanFromGate) { $('stageSetup').classList.remove('on'); $('stageGate').classList.add('on'); mountViewport(true); fgStatus('正在加载引擎 / 摄像头…', '') }
    else { $('stageGate').classList.remove('on'); $('stageSetup').classList.add('on'); mountViewport(false) }
    try { $('authBtn').disabled = true; $('fgStart').disabled = true } catch (e) {}
    resetChecks(); setCheck(0, 'active')
    initEngine().then(function (ok) {
      if (!ok) { setCheck(0, 'err'); abortScan('引擎不可用 · 请检查 wasm 资源'); return }
      setCheck(0, 'ok')
      return startCamera(selectedDeviceId).then(function (cok) {
        if (!cok) return startCamera('')
      })
    }).then(function (v) {
      if (v === undefined && !engineReady) return
      if (v === false) { setCheck(0, 'err'); abortScan('摄像头不可用 · 请检查权限'); return }
      setCheck(1, 'ok')
      sizeOverlay(); scanning = true; lastTs = 0
      scan = { stable: 0, lastX: overlay.width / 2, lastY: overlay.height / 2, pct: 0, sub: '检测面部中...' }
      try { $('scanPct').classList.add('on'); $('fgPct').style.display = 'block'; $('laser').classList.add('on') } catch (e) {}
      log((intent === 'enroll' ? 'Enrollment' : 'Recognition') + ' started · ' + mode.toUpperCase() + ' / ' + delegate, 'ok')
      diag = { fps: 0, frames: 0, fpsT: 0, errs: 0, faces: 0 }
      raf = global.requestAnimationFrame(detectLoop)
    }).catch(function (e) { abortScan('启动异常 · ' + String(e && e.message || e).slice(0, 40)) })
  }
  function abortScan(msg) {
    try { $('authBtn').disabled = false; $('fgStart').disabled = false; $('fgStart').textContent = '◈ 启动人脸识别 / START SCAN' } catch (e) {}
    scanning = false
    if (scanFromGate) { $('stageSetup').classList.remove('on'); $('stageGate').classList.add('on'); fgStatus(msg, 'err') }
    else log(msg, 'err')
  }

  function noteDiag(ts, faces) {
    diag.frames++; if (faces) diag.faces++
    if (ts - diag.fpsT >= 1000) { diag.fps = Math.round(diag.frames * 1000 / (ts - diag.fpsT || 1)); diag.frames = 0; diag.fpsT = ts; try { $('fps').textContent = diag.fps } catch (e) {} }
  }
  function detectLoop(ts) {
    if (!scanning || !scan) return
    raf = global.requestAnimationFrame(detectLoop)
    if (global.performance.now() - gateStart > GATE_TIMEOUT) {
      if (gateRequiredOk() && lmRef) { finalize(lmRef); return }
      log('Gate TIMEOUT · 请重试', 'err'); abortScan('校验超时 · 请重新点击扫描'); return
    }
    if (!engineReady || video.readyState < 2) { noteDiag(ts, 0); return }
    if (ts <= lastTs) return
    var dt = Math.min(80, ts - lastTs); lastTs = ts
    var res
    try { res = engine.detectForVideo(video, ts) }
    catch (e) { diag.errs++; try { $('detectErr').textContent = diag.errs } catch (e2) {}; if (diag.errs % 12 === 0) rebuildEngine('detect errors'); noteDiag(ts, 0); return }
    var faces = res.faceLandmarks || []
    noteDiag(ts, faces.length > 0)
    if (!faces.length) {
      octx.clearRect(0, 0, overlay.width, overlay.height)
      try { $('facebox').classList.remove('on'); $('iris').classList.remove('on') } catch (e) {}
      scan.stable = Math.max(0, scan.stable - dt * .6)
      scan.sub = '未检测到面部 · 请将面部置于取景框内'
      updateScanUI(); return
    }
    var lm = faces[0], m = coverMapping(); lmRef = lm
    var b = faceBounds(lm, m)
    var bCx = (b.minX + b.maxX) / 2, bCy = (b.minY + b.maxY) / 2
    var off = Math.hypot(bCx - overlay.width / 2, bCy - overlay.height / 2) / (overlay.width / 2)
    var wRatio = (b.maxX - b.minX) / overlay.width
    var q = Math.max(0, Math.min(1, (1 - off) * .6 + Math.min(1, wRatio / .6) * .4))
    evaluateGate(lm, faces, q, video.videoWidth || 1280, video.videoHeight || 720, ts)
    updateGateUI(ts); drawMesh(lm)
    var fb = $('facebox'); fb.classList.add('on')
    fb.style.left = bCx + 'px'; fb.style.top = bCy + 'px'; fb.style.width = (b.maxX - b.minX) + 'px'; fb.style.height = (b.maxY - b.minY) + 'px'
    var s = overlay.width / (viewport.clientWidth || 1)
    if (mode === 'iris' && lm[468] && lm[473]) {
      var p1 = project(lm, 468, m), p2 = project(lm, 473, m), ir = $('iris')
      ir.classList.add('on'); ir.style.left = p1.x + 'px'; ir.style.top = p1.y + 'px'; ir.style.width = (76 * s) + 'px'; ir.style.height = (76 * s) + 'px'
    } else $('iris').classList.remove('on')

    var eyeGap = function (a, bb) { return lm[a] && lm[bb] ? Math.abs(lm[a].y - lm[bb].y) : 0 }
    var eyeScore = Math.min(1, Math.max(eyeGap(159, 145), eyeGap(386, 374)) / .010)
    var move = Math.hypot(bCx - scan.lastX, bCy - scan.lastY); scan.lastX = bCx; scan.lastY = bCy
    var stableScore = Math.max(0, 1 - move / (overlay.width * .06))
    var quality = Math.max(0, Math.min(1, q * .65 + eyeScore * .25 + stableScore * .10))
    var rate = .35 + quality * .95
    scan.stable = Math.min(1100, scan.stable + dt * rate)
    if (quality < .32) scan.sub = '请正对摄像头并睁眼'
    else if (quality < .65) scan.sub = mode === 'iris' ? '虹膜采集中 · 请保持稳定' : '面部采集中 · 请保持稳定'
    else scan.sub = mode === 'iris' ? '虹膜已锁定 · 保持不动' : '面部已锁定 · 保持不动'
    scan.pct = Math.min(100, Math.round(scan.stable / 1100 * 100))
    if (!livenessGrace && global.performance.now() - gateStart > 5000 && gateRequiredOk()) livenessGrace = true
    var pending = gatePending()
    if (scan.pct >= 100 && !pending.length) { log('Face-ID gate · all 9 checks PASSED', 'ok'); finalize(lm) }
    else if (scan.pct >= 100) {
      GATE_KEYS.forEach(function (k) { if (GATE_EL[k] && !gateLatch[k]) GATE_EL[k].classList.add('pending') })
      scan.sub = '校验等待 · ' + pending.slice(0, 2).join(' / ')
    }
    updateScanUI()
  }
  function updateScanUI() {
    try {
      $('scanPct').textContent = String(scan.pct).padStart(2, '0') + '%'
      $('scanSub').textContent = scan.sub
      $('scanMode').textContent = mode === 'iris' ? 'IRIS CRYPTOGRAPHY SCAN' : 'FACIAL TOPOLOGY SCAN'
      if (scanFromGate) { $('fgPct').textContent = $('scanPct').textContent; fgStatus(scan.sub, scan.pct >= 100 ? 'ok' : '') }
      try { $('fgConf').textContent = Math.round(scan.pct) + '%' } catch (e) {}
    } catch (e) {}
  }
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms) }) }

  function finalize(lm) {
    scan.phase = 'verify'; scanning = false
    if (raf) { global.cancelAnimationFrame(raf); raf = null }
    try { $('laser').classList.remove('on'); $('scanSub').textContent = '正在提取生物特征并比对...' } catch (e) {}
    setCheck(1, 'ok'); setCheck(2, 'active')
    var sub = ''; try { sub = ($('subject').value || '').trim() || (template && template.subject) || 'OPERATOR' } catch (e) { sub = 'OPERATOR' }
    var isEnroll = scanIntent === 'enroll'
    return wait(220).then(function () {
      var pass = false, m = { score: 1 }
      if (isEnroll) {
        template = { subject: sub, mode: mode, geo: geoVector(lm), irisL: irisVector(lm, 'L'), irisR: irisVector(lm, 'R'), ts: Date.now() }
        pass = true
        log('Template ENROLLED · ' + sub + '（仅内存）', 'ok')
      } else {
        if (!template) { log('No template · 请先录入人脸', 'err'); return false }
        m = matchScore(lm)
        var th = mode === 'iris' ? .72 : .78
        pass = m.score >= th
        log('Match ' + m.score.toFixed(3) + ' / ' + th + ' · ' + (pass ? 'PASS' : 'FAIL'), pass ? 'ok' : 'err')
      }
      setCheck(2, pass ? 'ok' : 'err')
      return wait(380).then(function () {
        setCheck(3, pass ? 'ok' : 'err')
        try { $('scanPct').classList.remove('on'); $('fgPct').style.display = 'none'; $('facebox').classList.remove('on'); $('iris').classList.remove('on') } catch (e) {}
        scan = null
        if (isEnroll) {
          log('⟪ SETUP COMPLETE ⟫ → face recognition gate', 'alien')
          enterPhase('facegate')
          fgStatus('✓ 人脸信息已录入 · 请进行人脸识别登录', 'ok')
        } else if (pass) {
          log('⟪ FACE VERIFIED ⟫ → voice confirmation', 'alien')
          stopCamera(); mountViewport(false); enterPhase('voice')
          setTimeout(startVoiceConfirm, 420)
        } else {
          enterPhase('facegate')
          fgStatus('✕ 识别未通过 · 请再试一次', 'err')
        }
        return pass
      })
    })
  }

  /* ---------------- voice ---------------- */
  var SpeechRec = global.SpeechRecognition || global.webkitSpeechRecognition
  function vgMsg(text, cls) { try { var e = $('vgSub'); e.textContent = text; e.className = 'dshg-vsub' + (cls ? ' ' + cls : '') } catch (e2) {} }
  function ttsSpeak(text) {
    if (!('speechSynthesis' in global)) { vgMsg('浏览器不支持语音播报 · 请点确认按钮', 'err'); return }
    try {
      global.speechSynthesis.cancel()
      var u = new SpeechSynthesisUtterance(text); u.lang = 'zh-CN'; u.rate = .92; u.pitch = 1; u.volume = 1
      var vs = global.speechSynthesis.getVoices() || []
      var zh = vs.filter(function (v) { return /^zh/i.test(v.lang) })[0] || vs.filter(function (v) { return /chi|cmn/i.test(v.lang) })[0]
      if (zh) u.voice = zh
      global.speechSynthesis.speak(u)
    } catch (e) { log('TTS unavailable', 'warn') }
  }
  function stopVoice() {
    voiceActive = false; try { $('vgWave').classList.remove('on') } catch (e) {}
    if (vgRecog) { try { vgRecog.onresult = vgRecog.onerror = vgRecog.onend = null; vgRecog.abort() } catch (e) {} vgRecog = null }
    if ('speechSynthesis' in global) { try { global.speechSynthesis.cancel() } catch (e) {} }
  }
  function startVoiceConfirm() {
    if (voiceActive) return
    voiceActive = true
    var who = (template && template.subject) || '操作员'
    vgMsg('生物特征已验证 · 正在播报确认指令…')
    ttsSpeak('身份识别通过，欢迎回来，' + who + '。请说“确认登录”，或点击确认按钮进入深度求索主控系统。')
    if (!SpeechRec) {
      vgMsg('浏览器不支持语音识别 · 请点击“确认登录”按钮', 'err')
      setTimeout(function () { if (voiceActive) vgMsg('请说“确认登录”或点击下方按钮完成登录') }, 2200)
      return
    }
    try {
      vgRecog = new SpeechRec(); vgRecog.lang = 'zh-CN'; vgRecog.continuous = false; vgRecog.interimResults = false; vgRecog.maxAlternatives = 1
      vgRecog.onresult = function (e) {
        var said = String(e.results[0][0].transcript || '').replace(/\s/g, '')
        try { $('vgHeard').textContent = '识别到语音：' + said } catch (e2) {}
        if (/确认|登录|进入|允许|是|OK|ok|yes/i.test(said)) { vgMsg('✓ 语音确认通过 · 正在进入主控…', 'ok'); confirmVoiceLogin() }
        else vgMsg('未识别到确认指令 · 请说“确认登录”，或点击按钮', 'err')
      }
      vgRecog.onerror = function (e) { if (e.error === 'no-speech' || e.error === 'aborted') return; vgMsg('语音识别未启动（' + e.error + '）· 请点击按钮', 'err') }
      vgRecog.onend = function () { try { $('vgWave').classList.remove('on') } catch (e) {}; if (voiceActive) { vgMsg('请说“确认登录”或点击下方按钮完成登录'); setTimeout(function () { try { vgRecog && vgRecog.start(); $('vgWave').classList.add('on') } catch (e) {} }, 900) } }
      vgRecog.start(); $('vgWave').classList.add('on')
    } catch (e) { vgMsg('麦克风未就绪 · 请点击“确认登录”按钮', 'err') }
  }
  function confirmVoiceLogin() {
    unlocked = true
    enterPhase('unlocked') // 内部会 stopVoice()
    setTimeout(function () { ttsSpeak('登录确认，正在进入深度求索主控系统。') }, 120)
  }

  /* ---------------- controls ---------------- */
  try {
    $('tabFace').onclick = function () { if (scanning) return; mode = 'face'; $('tabFace').classList.add('active'); $('tabIris').classList.remove('active'); $('modeDesc').innerHTML = '<b>FACE RECOGNITION //</b> 真实摄像头采集 478 点面部拓扑，注册后以几何特征做本地 1:1 比对。'; log('Protocol → FACE') }
    $('tabIris').onclick = function () { if (scanning) return; mode = 'iris'; $('tabIris').classList.add('active'); $('tabFace').classList.remove('active'); $('modeDesc').innerHTML = '<b>IRIS SCAN //</b> 真实虹膜定位（关键点 468–477）+ 纹理采样，与已注册模板做双重比对。'; log('Protocol → IRIS') }
    $('camSelect').onchange = function () { applyCamChoice(this.value) }
    $('fgCamSelect').onchange = function () { applyCamChoice(this.value) }
    $('camRefresh').onclick = function () { listCameras(false) }
    $('fgCamRefresh').onclick = function () { listCameras(false) }
    $('authBtn').onclick = function () { beginScan('enroll') }
    $('toGateBtn').onclick = function () { enterPhase('facegate') }
    $('fgStart').onclick = function () { beginScan('login') }
    $('clearBtn').onclick = function () { template = null; unlocked = false; try { $('tplState').textContent = '未注册 / NONE'; $('tplState').className = 'err' } catch (e) {}; log('Template cleared（内存）', 'warn') }
    $('vgConfirm').onclick = function () { vgMsg('手动确认登录 · 正在进入主控…', 'ok'); confirmVoiceLogin() }
    $('vgMic').onclick = function () { stopVoice(); voiceActive = false; vgMsg('重新监听语音指令…'); setTimeout(startVoiceConfirm, 150) }
    $('vgBack').onclick = function () { stopVoice(); enterPhase('facegate') }
    lockPill.onclick = function () { unlocked = false; lockPill.style.display = 'none'; root.classList.remove('done', 'hidden'); enterPhase(template ? 'facegate' : 'setup') }
    $('skipBtn').onclick = function () {
      if (!global.confirm('跳过生物识别门禁直接进入 DSH？\n（跳过不会注册任何生物特征）')) return
      stopVoice(); unlocked = true; root.classList.add('done'); setTimeout(function () { root.classList.add('hidden') }, 950)
    }
  } catch (e) {}

  // 请求摄像头权限后可枚举到真实设备名
  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    try { navigator.mediaDevices.addEventListener('devicechange', function () { listCameras(true) }) } catch (e) {}
  }
  listCameras(true)
  try { sizeOverlay(); global.addEventListener('resize', sizeOverlay) } catch (e) {}

  // 诊断入口，便于排查（不污染宿主全局命名空间太多）
  global.__DSH_HARNESS_GATE_DIAG__ = function () {
    return { version: VERSION, phase: phase, engine: engineMode, delegate: delegate, ready: engineReady, template: !!template, unlocked: unlocked, fps: diag.fps, errors: diag.errs }
  }
})(globalThis)
