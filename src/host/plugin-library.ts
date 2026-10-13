// ---- 图库管理：清单 / 打开 / 新建 / 改名 / 软删除 / 恢复 / 按路径打开外部文件 ----
ctx.effect(function () {
  return onRpc('doc:list', async function (args) {
    await ensureLoaded(args && args.where, args && args.session)
    var ticket = docTicket()
    // rescan 为真时忽略 TTL 立刻重扫（选择器上的「重新扫描」按钮走这条路）
    var items = await refreshLibrary(!!(args && args.rescan))
    if (!ticketHolds(ticket)) {
      // 同 doc:get：扫描是异步的，别的会话的切库可能在这中间把指针换走 ——
      // 那样返回的清单与 dir 就是**别人的图库**。换回来重扫一次。
      await ensureLoaded(args && args.where, args && args.session)
      items = await refreshLibrary(!!(args && args.rescan))
    }
    return {
      ok: true, dir: lib.dir, scope: lib.scope, workspace: lib.workspace,
      // **目录关系要说清**：`dir` 是当前这一层的图库，`root` 是 key 的基准（图库根），
      // `sessionDir` + `scanFrom` 才是这次检测的锚点与范围。
      root: root.workspace || '', sessionDir: root.scanFrom || '',
      scanRel: root.scanRel || '', scanFrom: root.scanFrom || root.workspace || '',
      current: doc.name, external: doc.external || null,
      // 每张图的 `rel` / `relOutside` 按**这一次请求的**锚点重算（缓存是共享的，烘焙会串味）
      items: withRel(items, root.scanFrom || root.workspace),
      // 项目里散落的 mermaid 文件（同一次扫描的副产物）：按路径打开
      files: libraryFiles,
      libraryRev: libraryRev,
    }
  })
})

ctx.effect(function () {
  return onRpc('doc:openPath', async function (args) {
    await ensureLoaded(args && args.where, args && args.session)
    var path = resolveDiagramPath(args && args.path)
    if (!path) return { ok: false, error: '需要一个文件路径：绝对路径，或相对项目根的路径' }
    // 白名单拦截：仅允许 .mmd 或 .mermaid 格式的图文件，防止意外覆写普通源码
    if (!isDiagramPath(path)) {
      return { ok: false, error: '外部文件必须是 .mmd 或 .mermaid 格式的图文件' }
    }
    return openExternal(path, !!(args && args.create), policyOfSessionId(args && args.session))
  })
})

ctx.effect(function () {
  return onRpc('doc:open', async function (args) {
    await ensureLoaded(args && args.where, args && args.session)
    var raw = args && typeof args.key === 'string' ? args.key
      : (args && typeof args.name === 'string' ? args.name : '')
    if (!raw.trim()) return { ok: false, error: '需要 key（图名，或 `子项目/图名`）' }
    var k = resolveKey(raw)
    if (!k) return { ok: false, error: '当前没有项目根，无法引用子项目的图' }
    // 打开子项目的图 = 把「当前层」切过去：此后坐标、落盘、AI 上下文都落在那一层
    if (k.dir !== lib.dir) {
      // 换层要**两步**，少一步都是静默错位：
      //  ① 先把当前这份存进它自己的槽 —— 否则上一层从内存里消失，同步路径（`syncWorkspaceFor`）
      //     再也命中不了它，提示词只能对模型说「画布停在别的图上」，而它其实就在自己项目里；
      //  ② 再换一份**全新的 doc**（`resetToWorkspace` 干的就是这个）—— 只把 `lib` 指过去是不够的：
      //     `loadInto` 是**原地**改 `doc`，而旧那份已经挂在 ① 的槽里，原地改会让那个槽悄悄
      //     变成这一层的文档（2026-10-01 复核实测：回执 `dir` 说 A、`file` 却在 B，还报 saved:true）。
      saveActiveSlot()
      // **会话目录要一起传**：`resetToWorkspace` 的第三参是检测锚点，漏了它这一步的扫描范围
      // 就从会话目录放宽到图库根，紧接着 `afterSwitch()` 的 `refreshLibrary(true)` 会把
      // 图库根整棵扫进来（别的子项目的图库跟着进「同图库」清单）。
      resetToWorkspace(resolveLibCanonical(String((root && root.workspace) || '')), k, sessDirOf(args))
    }
    var r = await loadDiagramAt(k, k.name, !!(args && args.create), policyOfSessionId(args && args.session))
    if (!r.ok) {
      await refreshLibrary()
      return { ok: false, error: r.error, items: libraryCache, dir: lib.dir }
    }
    // 记住**这个会话自己选了哪一层**：此后每一趟都按它认文件，别的会话切库不会把它顶走
    // **回执不许说谎**：这一趟的加载如果被别的请求抢走了，`lib`/`doc` 可能是别人的，
    // 直接 `afterSwitch()` 会返回一份「dir 说 A、file 在 B」的混合状态并报成功。
    if (!(lib.dir === k.dir && docInLayer(k.dir))) {
      logEvent('warn', 'doc.open.stolen', { want: k.dir, now: lib.dir })
      return { ok: false, error: '这一趟打开被另一个请求切走了（画布现在在 ' + lib.dir + '）—— 重试一次' }
    }
    // 记**这次请求真正要的那一层**（`k`），不是 await 之后读到的全局 `lib`：
    // 并发时 `lib` 可能已被另一个会话换走，那样会把别人的层永久记成本会话的层。
    rememberLayer(args && args.session, k, root && root.workspace)
    return afterSwitch()
  })
})

ctx.effect(function () {
  return onRpc('doc:rename', async function (args) {
    await ensureLoaded(args && args.where, args && args.session)
    if (!fs) return { ok: false, error: 'fs 服务不可用' }
    // **缺凭据不许退化成默认值。** `resolveKey(undefined)` 的 name 会兜成默认图名
    // （`splitKey('')` → `architecture`）：一句 `{"method":"doc:rename","args":{"to":"zzz"}}`
    // 就把用户的主图软删了、还建出一张 zzz.mmd，回执却是 ok:true。照 doc:delete 抄校验。
    var fromRaw = args && args.from
    var toRaw = args && args.to
    if (typeof fromRaw !== 'string' || fromRaw.trim() === '' ||
        typeof toRaw !== 'string' || toRaw.trim() === '') {
      return { ok: false, error: '需要 from 与 to（图名，或 `子项目/图名`）' }
    }
    var a = resolveKey(fromRaw)
    var b = resolveKey(toRaw)
    if (!a || !b) return { ok: false, error: '当前没有项目根，无法引用子项目的图' }
    if (a.project !== b.project) {
      return { ok: false, error: '改名不能跨图库（' + (a.project || '根') + ' → ' + (b.project || '根') + '）；跨库请手工移动文件' }
    }
    if (a.name === b.name) return { ok: false, error: '新名字和旧名字一样' }
    // 目标已存在就不动 —— 改名不该悄悄吞掉另一张图
    try {
      var probe = await fs.resolve(fileAt(b.dir, b.name))
      if (await fs.stat(probe)) return { ok: false, error: '已经有叫「' + args.to + '」的图了' }
    } catch (e) {}
    var text
    try {
      text = await fs.readText(await fs.resolve(fileAt(a.dir, a.name)))
    } catch (e) {
      return { ok: false, error: '读不到「' + args.from + '」：' + msgOf(e) }
    }
    try {
      var renamePolicy = policyOfSessionId(args && args.session)
      await fs.writeText(await fs.resolve(fileAt(b.dir, b.name)), text, undefined, undefined, renamePolicy)
      // 旧文件只能软删（fs 没有 unlink），于是「改名」= 新建 + 把旧的标成已删除
      await fs.writeText(await fs.resolve(fileAt(a.dir, a.name)), TOMBSTONE + '\n' + text, undefined, undefined, renamePolicy)
      // 留言表也得跟着搬：它以**文件名**为键，不搬就等于新名字那张图一条留言都没有
      var noteMoveErr = await renameNoteStoreFor(fileAt(a.dir, a.name), fileAt(b.dir, b.name), renamePolicy)
      if (noteMoveErr) logEvent('warn', 'notes.rename.fail', { from: a.name, to: b.name, error: noteMoveErr })
      // 代码锚点指纹基线表也跟着搬：以图文件名为键，不搬新图就丢失 baseline 且留下孤儿
      var driftMoveErr = await renameDriftStoreFor(fileAt(a.dir, a.name), fileAt(b.dir, b.name), renamePolicy)
      if (driftMoveErr) logEvent('warn', 'drift.rename.fail', { from: a.name, to: b.name, error: driftMoveErr })
    } catch (e) {
      return { ok: false, error: '改名失败：' + msgOf(e) }
    }
    if (doc.name === a.name && lib.dir === a.dir) {
      doc.name = b.name
      doc.file = fileAt(b.dir, b.name)
      doc.tombstoned = hasTombstone(text)
    }
    // 强制扫：改名后的回执与紧随的 doc:list 必须立刻看到新名字（TTL 会拿着旧清单最长 15 秒）。
    await refreshLibrary(true)
    return fullOf()
  })
})

ctx.effect(function () {
  return onRpc('doc:delete', async function (args) {
    await ensureLoaded(args && args.where, args && args.session)
    if (!fs) return { ok: false, error: 'fs 服务不可用' }
    // 缺 key 从前会**退化成默认图名**（`splitKey('')` → name 兜成 architecture），一句不带 key 的
    // `{"method":"doc:delete"}` 就把默认图软删了（审计第 4 条）。缺凭据一律拒绝。
    // 下面 `if (!dk)` 那条**不是**死代码：全局图库里 `resolveKey('子/图')` 会因没有项目根返回 null。
    var dkRaw = args && (args.key || args.name)
    if (typeof dkRaw !== 'string' || dkRaw.trim() === '') return { ok: false, error: '需要 key（图名，或 `子项目/图名`）' }
    var dk = resolveKey(dkRaw)
    if (!dk) return { ok: false, error: '需要 key（图名，或 `子项目/图名`）' }
    var name = dk.name
    var text
    try {
      text = await fs.readText(await fs.resolve(fileAt(dk.dir, dk.name)))
    } catch (e) {
      return { ok: false, error: '读不到「' + (args && (args.key || args.name)) + '」：' + msgOf(e) }
    }
    if (!hasTombstone(text)) {
      try {
        await fs.writeText(await fs.resolve(fileAt(dk.dir, dk.name)), TOMBSTONE + '\n' + text, undefined, undefined, policyOfSessionId(args && args.session))
      } catch (e) {
        return { ok: false, error: '删除失败：' + msgOf(e) }
      }
    }
    // 删的正好是当前这张 → **别让画布停在刚打上墓碑的那份内容上**。
    // 从前这里是 `doc.name = DEFAULT_DIAGRAM; loadedFor = null; ensureLoaded()` —— 于是 loadInto
    // 又把那份带 `%% @deleted` 的文件读回来：画布照旧显示它的节点、`tombstoned:true`，还能继续编辑，
    // 而清单里它已经 `deleted:true`（与这句注释说的正好相反）。
    if (doc.name === name && lib.dir === dk.dir) {
      var target = { dir: dk.dir, scope: dk.scope, workspace: dk.workspace }
      if (lib.dir !== target.dir) { lib = target; loadedFor = null }
      // 同一图库里还有活着的图就切过去（用户的画布落在真内容上）；一张都不剩才清空成空文档。
      var lives = []
      try {
        var all = await listDiagrams(dk.dir)
        for (var dl = 0; dl < all.length; dl++) if (!all[dl].deleted) lives.push(all[dl].name)
      } catch (eLives) { lives = [] }
      if (lives.length > 0) {
        var rl = await loadDiagramAt(target, lives[0], false, policyOfSessionId(args && args.session))
        if (rl && rl.ok) {
          var outSw = await afterSwitch()
          outSw.items = libraryCache
          return outSw
        }
      }
      // 一张活图都不剩：画布清成一份**空文档**（以 newDocState() 为唯一源，补齐身份与空库字段；不 adopt 墓碑内容、不落盘）。
      // doc.file 仍写着默认图名，但它此刻带墓碑 —— 写路径的墓碑守卫会拒绝把它当活图改写，
      // 用户的软删除不会被一次无关保存抹掉；要拿回来走 doc:restore。
      var nextDoc = newDocState()
      nextDoc.file = fileAt(dk.dir, DEFAULT_DIAGRAM)
      nextDoc.absent = true
      nextDoc.revision = doc.revision
      nextDoc.updatedBy = doc.updatedBy
      nextDoc.updatedAt = doc.updatedAt
      doc = nextDoc
      // loadedFor 设上，这条空画布才「粘得住」：下一次 doc:get 不会又把墓碑文件读回来。
      loadedFor = lib.dir
      lastChange = { by: 'user', rev: doc.revision, nodes: [] }
      await refreshLibrary(true)
      var outDel = fullOf()
      outDel.items = libraryCache
      return outDel
    }
    await refreshLibrary(true)
    var outDel2 = fullOf()
    outDel2.items = libraryCache
    return outDel2
  })
})

ctx.effect(function () {
  return onRpc('doc:restore', async function (args) {
    await ensureLoaded(args && args.where, args && args.session)
    if (!fs) return { ok: false, error: 'fs 服务不可用' }
    var rkRaw = args && (args.key || args.name)
    if (typeof rkRaw !== 'string' || rkRaw.trim() === '') return { ok: false, error: '需要 key（图名，或 `子项目/图名`）' }
    var rk = resolveKey(rkRaw)
    if (!rk) return { ok: false, error: '需要 key（图名，或 `子项目/图名`）' }
    var text
    try {
      text = await fs.readText(await fs.resolve(fileAt(rk.dir, rk.name)))
    } catch (e) {
      return { ok: false, error: '读不到「' + (args && (args.key || args.name)) + '」：' + msgOf(e) }
    }
    if (hasTombstone(text)) {
      try {
        await fs.writeText(await fs.resolve(fileAt(rk.dir, rk.name)), text.replace(TOMBSTONE_STRIP_RE, ''), undefined, undefined, policyOfSessionId(args && args.session))
      } catch (e) {
        return { ok: false, error: '恢复失败：' + msgOf(e) }
      }
      // **内存里那个墓碑也要摘掉。** 只改盘不清内存的话，恢复之后的下一次保存又会把
      // `%% @deleted` 写回去 —— 用户点了「恢复」，看起来成功了，过一会儿它自己又变回已删除
      // （审计第 6 条）。
      if (doc.name === rk.name && lib.dir === rk.dir) {
        doc.tombstoned = false
        // 画布可能刚被「删掉当前图」清空过（doc.absent）——那就把它重新读回来，
        // 否则用户点了「恢复」，清单里它活了、画布却还空着。
        if (doc.absent) {
          loadedFor = null
          await ensureLoaded(undefined, args && args.session)
        }
      }
    }
    // 强制扫：刚「恢复」的图必须立刻回到清单里（走 TTL 的话回执 items 里它还写着 deleted:true，
    // 而界面默认 rescan:false，最长 15 秒都看不到它回来）。
    await refreshLibrary(true)
    return { ok: true, dir: lib.dir, scope: lib.scope, workspace: lib.workspace, current: doc.name, items: libraryCache }
  })
})

