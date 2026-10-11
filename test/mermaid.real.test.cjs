// 解析器（另一半）：把序列化产物喂给**真 Mermaid**（jsdom + mermaid 11.x）校验。
// 公共装载（读 dist/mermaid.js、断言计数器、汇总出口）在 mermaid.shared.cjs；纯函数层的分节在 mermaid.parser.test.cjs。
const {
  fs, path,
  parseMermaid, serializeDoc, roundTripDiff, cleanId, q, unquote, qRef, unquoteRef,
  ARROWS, MERMAID_KEYWORD_LIST, stableJson, firstDiff, HEADER_LINE_FOR_TEST, check, eq, endPhase,
} = require('./mermaid.shared.cjs');

// ==================== 真 Mermaid 校验 ====================
// 上面所有断言都是「解析器自说自话」：它认为合法的，真 Mermaid 可能根本读不了
// （反引号那条就是：写出 `n1["`arch_edit` 是默认"]`，真 Mermaid Lexical error，而往返检查全安静）。
// 这套测试从前**没有一处**把序列化产物喂给真 mermaid.parse() —— 那就是 finding 1/2/10 一直绿的结构性原因。
// 这一节用 devDependency 的 jsdom + mermaid（11.x）真跑一遍。
;(async () => {
  let mermaid = null;
  try {
    const { JSDOM } = require('jsdom');
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    global.window = dom.window;
    global.document = dom.window.document;
    global.navigator = dom.window.navigator;
    const mod = await import(path.join(__dirname, '..', 'node_modules', 'mermaid', 'dist', 'mermaid.esm.mjs'));
    mermaid = mod.default;
    mermaid.initialize({ startOnLoad: false, securityLevel: 'loose' });
  } catch (e) {
    // 加载不了必须**报失败**，不许静默跳过 —— 跳过就是一个空测试。
    check('真 Mermaid 校验脚手架（jsdom + mermaid）能加载', false, String((e && e.message) || e));
  }
  async function accepts(text) {
    if (!mermaid) return { ok: false, err: 'mermaid 未加载' };
    try { await mermaid.parse(text); return { ok: true }; }
    catch (e) { return { ok: false, err: String((e && e.message) || e).split('\n')[0] }; }
  }

  if (mermaid) {
    console.log('\n[23] 序列化产物必须是合法 Mermaid（8 种形状 × 各种标签）');
    {
      const shapes = ['rect', 'round', 'stadium', 'circle', 'diamond', 'hex', 'cyl', 'sub', 'asym'];
      const labels = [
        '`arch_edit` 是默认', '单个 ` 反引号', '他说 "行"', '号 #3 通道', 'x < y', 'y > x', 'a & b',
        '第一行\n第二行', '中文标签', '😀 emoji', '读 | 写', 'Array[int]', 'f(x) 求值', '读 [conf] 配置',
        'a ] b', 'a } b', 'a ) b', '{{hex 里的花括号}}', ' 首尾空格 ', ' ',
      ];
      for (const shape of shapes) {
        for (const label of labels) {
          const doc = {
            direction: 'TD', summary: '', edges: [], extras: [], groups: [],
            nodes: [{ id: 'n1', label: label, shape: shape, group: null, x: 0, y: 0, link: null, files: [] }],
          };
          const text = serializeDoc(doc);
          const r = await accepts(text);
          check('shape=' + shape + ' label=' + JSON.stringify(label) + ' 合法',
            r.ok, { text: text.split('\n').filter(l => l.indexOf('n1') >= 0), err: r.err });
        }
      }
      // 空 label：`n1[""]` 是非法 Mermaid（finding 10），退化成 id 就合法
      for (const shape of shapes) {
        const doc = {
          direction: 'TD', summary: '', edges: [], extras: [], groups: [],
          nodes: [{ id: 'n1', label: '', shape: shape, group: null, x: 0, y: 0, link: null, files: [] }],
        };
        const r = await accepts(serializeDoc(doc));
        check('shape=' + shape + ' 空 label 合法（退化成 id）', r.ok, { err: r.err, text: serializeDoc(doc) });
      }
      // 空组 label：`subgraph g1[""]` 是非法 Mermaid
      const blankGroup = {
        direction: 'TD', summary: '', edges: [], extras: [], groups: [{ id: 'g1', label: '' }], nodes: [],
      };
      check('空组 label 的产物合法', (await accepts(serializeDoc(blankGroup))).ok, serializeDoc(blankGroup));
      const spaceGroup = {
        direction: 'TD', summary: '', edges: [], extras: [], groups: [{ id: 'g1', label: ' ' }], nodes: [],
      };
      check('纯空白组 label 的产物合法（退化成组 id）', (await accepts(serializeDoc(spaceGroup))).ok, serializeDoc(spaceGroup));

      // 标签里带 | 的连线 + 各种箭头（含 Mermaid 11 的圆头 / 交叉端点）
      const ARROW_SAMPLES = [
        '-->', '---', '-.->', '==>', '===', '~~~', '<-->', '<==>',
        '--o', '--x', 'o--o', 'x--x', 'o--x', 'x--o', 'o---o', 'x---x', 'o---x', 'x---o',
        'o---', 'x---', 'o-->', 'x-->', 'o==o', 'x==x', 'o==>', 'x==>', '==o', '==x',
      ];
      for (const arrow of ARROW_SAMPLES) {
        const doc = {
          direction: 'TD', summary: '', extras: [], groups: [],
          nodes: [
            { id: 'A', label: 'A', shape: 'rect', group: null, x: 0, y: 0, link: null, files: [] },
            { id: 'B', label: 'B', shape: 'rect', group: null, x: 0, y: 0, link: null, files: [] },
          ],
          edges: [{ id: 'e1', from: 'A', to: 'B', label: '读 | 写', arrow: arrow }],
        };
        const text = serializeDoc(doc);
        const r = await accepts(text);
        const back = parseMermaid(text);
        check('箭头 ' + arrow + ' + 含 | 的标签：真 Mermaid 合法', r.ok, { err: r.err, line: text.split('\n').filter(l => l.indexOf('A ') >= 0) });
        check('箭头 ' + arrow + ' 往返后箭头与标签都在',
          back.edges.length === 1 && back.edges[0].arrow === arrow && back.edges[0].label === '读 | 写', back.edges);
        check('箭头 ' + arrow + ' 往返检查为空', roundTripDiff(doc).length === 0, roundTripDiff(doc));
      }
      // 负向对照：这条检查不是空转 —— 未转义的反引号（finding 1 的原样输出）必须被真 Mermaid 拒收。
      const badBacktick = await accepts('flowchart TD\n  n1["`arch_edit` 是默认"]');
      check('负向对照：未转义的反引号确实被真 Mermaid 拒收', !badBacktick.ok, badBacktick);
      // 负向对照：空 label 的原样输出也必须被拒收（finding 10）
      const badEmpty = await accepts('flowchart TD\n  n1[""]');
      check('负向对照：空 label 的原样输出确实被真 Mermaid 拒收', !badEmpty.ok, badEmpty);
      // 负向对照：关键字 id 的原样输出也必须被拒收（finding 2）
      const badKeyword = await accepts('flowchart TD\n  end["L"]');
      check('负向对照：关键字 id 的原样输出确实被真 Mermaid 拒收', !badKeyword.ok, badKeyword);
    }

    console.log('\n[24] 合法 Mermaid 语料：不进 extras、不出警告、真 Mermaid 合法');
    {
      // 判据是 extras/warnings 为空，**不是**逐个写死节点数 —— 换个 id 不该让这条红。
      const corpus = [
        'flowchart TD',
        '  A-->B',
        '  A---B',
        '  A-.->B',
        '  A==>B',
        '  A<-->B',
        '  A o--o B',
        '  A x--x B',
        '  A --o B',
        '  A --x B',
        '  A -. text .-> B',
        '  api-gateway --> db-primary',
        '  a.b --> c.d',
        '  a/b --> c',
        '  A:::cls --> B',
        '  A@{ shape: rounded, label: "x" }',
      ].join('\n');
      const d = parseMermaid(corpus);
      check('语料：extras 为空', d.extras.length === 0, d.extras);
      // 这份语料里 `a.b --> c.d` 与 `a/b --> c` 踩中了「归一撞名」那条修复：
      // `a.b` 与 `a/b` 都归一到 `a_b`，**从前是静默合并成一个**（零警告），
      // 现在给后来者 `a/b` 加稳定后缀 `a_b_2` 并出声。所以这一条不能再要求「零警告」——
      // 唯一允许的警告就是那条撞名说明（其余任何警告仍然是红的）。
      check('语料：唯一的警告是「a.b 与 a/b 归一后撞名」那条',
        d.warnings.length === 1 && d.warnings[0].indexOf('撞名') >= 0 && d.warnings[0].indexOf('a/b') >= 0, d.warnings);
      check('语料：真 Mermaid 合法', (await accepts(corpus)).ok);
      // 连边都进了模型，不是「没报错但什么都没收下」
      check('语料：14 条边全进了模型', d.edges.length === 14, d.edges.map(e => e.from + '-' + e.arrow + '>' + e.to));
      check('语料：连字符 / 点 / 斜杠 id 归一后都在模型里（撞名的那个加后缀活着）',
        ['api_gateway', 'db_primary', 'a_b', 'a_b_2', 'c_d'].every(id => d.nodes.some(n => n.id === id)), d.nodes.map(n => n.id));
      const aB = d.nodes.find(n => n.id === 'a_b');
      const aB2 = d.nodes.find(n => n.id === 'a_b_2');
      check('语料：撞名的两条 label 不互相覆盖（第一条是 a.b 的标题，第二条是 a/b 的标题）',
        !!aB && !!aB2 && aB.label === 'a.b' && aB2.label === 'a/b',
        d.nodes.filter(n => n.id.indexOf('a_b') === 0).map(n => [n.id, n.label]));
      check('语料：`:::` 后缀被剥离、边照常建立', d.edges.some(e => e.from === 'A' && e.to === 'B'), d.edges);
      check('语料：`@{ shape: rounded }` 映射成 round', d.nodes.find(n => n.id === 'A').shape === 'round', d.nodes.find(n => n.id === 'A'));
      // 序列化产物同样要合法、同样不许有 extras/警告
      const out = serializeDoc(d);
      check('语料：序列化产物真 Mermaid 合法', (await accepts(out)).ok, out);
      const back = parseMermaid(out);
      check('语料：序列化产物再解析 extras 与 warnings 都为空',
        back.extras.length === 0 && back.warnings.length === 0, { extras: back.extras, w: back.warnings });
      check('语料：往返检查为空', roundTripDiff(d).length === 0, roundTripDiff(d));

      // 换行 / 前缀分类的合法文本：注释与配置指令**不许丢**（finding 8）。
      // 注意：按 finding 8 的修法它们一律进 extras，所以这一组的判据是「原样保留 + 不警告 + 产物合法」，
      // 而不是 extras 为空 —— 那一对要求互斥，取舍写在报告里。
      const keptText = [
        '%%{init:{"theme":"dark"}}%%',
        'flowchart TD',
        '  %% 这是用户写的一句注释',
        '  subgraph g["G"]',
        '  direction LR',
        '  A --> B',
        '  end',
        '  A --x B',
      ].join('\n');
      const kd = parseMermaid(keptText);
      check('注释 / %%{init}%% / subgraph direction：原样留进 extras（不丢）',
        kd.extras.length === 3, kd.extras);
      check('注释 / %%{init}%% / subgraph direction：不产生警告', kd.warnings.length === 0, kd.warnings);
      check('注释 / %%{init}%% / subgraph direction：真 Mermaid 合法', (await accepts(keptText)).ok);
      const kOut = serializeDoc(kd);
      check('注释 / %%{init}%% / subgraph direction：产物真 Mermaid 合法', (await accepts(kOut)).ok, kOut);
      check('注释 / %%{init}%% / subgraph direction：产物往返稳定', serializeDoc(parseMermaid(kOut)) === kOut, kOut);
    }

    console.log('\n[25] Mermaid 关键字 id：序列化后真 mermaid.parse 通过、回读节点仍在、坐标仍对得上');
    {
      for (const kw of ['end', 'graph', 'flowchart', 'subgraph', 'link', 'click', 'direction', 'interpolate']) {
        const d = parseMermaid('flowchart TD\n  ' + kw + '["L"]\n%% @pos ' + kw + ' 10 20');
        const text = serializeDoc(d);
        const r = await accepts(text);
        check('关键字 id ' + kw + '：产物真 Mermaid 合法', r.ok, { err: r.err, text: text.split('\n').filter(l => l.trim()) });
        const back = parseMermaid(text);
        check('关键字 id ' + kw + '：回读节点仍在、坐标仍对得上',
          back.nodes.length === 1 && back.nodes[0].id === cleanId(kw) && back.nodes[0].x === 10 && back.nodes[0].y === 20,
          back.nodes);
        check('关键字 id ' + kw + '：往返检查为空', roundTripDiff(d).length === 0, roundTripDiff(d));
      }
      // 含 `end` 的**旧文件**：加载 → 落盘 → 再读，坐标不许丢（finding 2 的硬要求）
      const oldFile = [
        HEADER_LINE_FOR_TEST,
        'flowchart TD',
        '  subgraph 组["组"]',
        '    end["结束"]',
        '  end',
        '%% @pos end 10 20',
        '%% @file end "src/x.ts#sym"',
      ].join('\n');
      const od = parseMermaid(oldFile);
      const oOut = serializeDoc(od);
      const oBack = parseMermaid(oOut);
      check('含 end 的旧文件：加载就把它归一成 n_end 并带回坐标',
        od.nodes.some(n => n.id === 'n_end' && n.x === 10 && n.y === 20), od.nodes);
      check('含 end 的旧文件：落盘后仍能找回它的坐标',
        oBack.nodes.some(n => n.id === 'n_end' && n.x === 10 && n.y === 20), oBack.nodes);
      check('含 end 的旧文件：锚点也跟着走', oBack.nodes.find(n => n.id === 'n_end').files[0] === 'src/x.ts#sym',
        oBack.nodes.find(n => n.id === 'n_end').files);
      check('含 end 的旧文件：产物真 Mermaid 合法', (await accepts(oOut)).ok, oOut);
    }

    console.log('\n[26] 合法连接符 / Mermaid 11 新语法：节点与边都要进模型、extras 为空');
    {
      const cases = [
        ['A --> B', 1, '-->'],
        ['A --- B', 1, '---'],
        ['A -.-> B', 1, '-.->'],
        ['A ==> B', 1, '==>'],
        ['A <--> B', 1, '<-->'],
        ['A o--o B', 1, 'o--o'],
        ['A x--x B', 1, 'x--x'],
        ['A --o B', 1, '--o'],
        ['A --x B', 1, '--x'],
        ['A o--x B', 1, 'o--x'],
        ['A x--o B', 1, 'x--o'],
        ['A o---o B', 1, 'o---o'],
        ['A o--- B', 1, 'o---'],
        ['A -. text .-> B', 1, '-.->'],
      ];
      for (const [line, n, arrow] of cases) {
        const d = parseMermaid('flowchart TD\n  ' + line);
        check(line + '：边进模型（' + arrow + '）',
          d.edges.length === n && d.edges[0].arrow === arrow, d.edges);
        check(line + '：extras 为空且无警告', d.extras.length === 0 && d.warnings.length === 0, { e: d.extras, w: d.warnings });
        check(line + '：真 Mermaid 合法', (await accepts('flowchart TD\n  ' + line)).ok);
      }
      // `-. 文本 .->` 的标签要取到
      const dotted = parseMermaid('flowchart TD\n  A -. 说明文字 .-> B');
      check('A -. 文本 .-> B 的标签取到', dotted.edges[0].label === '说明文字', dotted.edges);
      // `id:::class`：样式丢掉、结构保住
      const cls = parseMermaid('flowchart TD\n  A:::cls --> B');
      check('A:::cls --> B：节点与边都在、extras 为空、无警告',
        cls.nodes.length === 2 && cls.edges.length === 1 && cls.extras.length === 0 && cls.warnings.length === 0, cls);
      // `id@{ shape: …, label: … }`
      const at = parseMermaid('flowchart TD\n  A@{ shape: rounded, label: "x" }');
      check('A@{ shape: rounded, label: "x" }：shape 与 label 都进模型',
        at.nodes[0].shape === 'round' && at.nodes[0].label === 'x', at.nodes);
      check('A@{ … } 无警告', at.warnings.length === 0, at.warnings);
      // 映射不了的 shape：结构保住 + **记一条警告说明丢了什么**
      const odd = parseMermaid('flowchart TD\n  A@{ shape: nosuchshape, label: "x" } --> B');
      check('映射不了的 @{shape} 记一条警告（说清丢了什么）',
        odd.warnings.length === 1 && odd.warnings[0].indexOf('nosuchshape') >= 0, odd.warnings);
      check('映射不了的 @{shape}：节点与边照样进模型',
        odd.nodes.length === 2 && odd.edges.length === 1 && odd.nodes.find(n => n.id === 'A').label === 'x', odd);
      // 不合法的端点写法（`o--`/`x--` 真 Mermaid 判 Parse error）不许长出一堆幽灵节点
      for (const badLine of ['A o-- B', 'A x-- B', 'A o== B']) {
        const b = parseMermaid('flowchart TD\n  ' + badLine);
        check(badLine + '（非法）整行进 extras，不长出幽灵节点',
          b.nodes.length === 0 && b.extras.length === 1, { n: b.nodes.map(x => x.id), e: b.extras });
      }
    }

    console.log('\n[27] 同形重复边不再被静默合并');
    {
      const d = parseMermaid('flowchart TD\n  A --> B\n  A --> B');
      check('源里两遍 A --> B：模型里是两条边', d.edges.length === 2, d.edges);
      const out = serializeDoc(d);
      check('两条边各自序列化（往返仍逐字节一致）', out.split('\n').filter(l => l.indexOf('A --> B') >= 0).length === 2, out);
      check('重复边往返稳定', serializeDoc(parseMermaid(out)) === out, out);
      check('重复边往返检查为空', roundTripDiff(d).length === 0, roundTripDiff(d));
      check('重复边产物真 Mermaid 合法', (await accepts(out)).ok, out);
    }

    console.log('\n[28] subgraph 里的关键字 / 空 label / 各种新语法（组合一遍）');
    {
      const text = [
        'flowchart TD',
        '  subgraph end["结束组"]',
        '    direction LR',
        '    link["链接"] --> click["点击"]',
        '  end',
        '  link -. 虚线 .-> click',
      ].join('\n');
      const d = parseMermaid(text);
      check('组合语料：关键字 id 归一 + 子图内 direction 保留 + extras 只有那一条',
        d.nodes.some(n => n.id === 'n_link') && d.nodes.some(n => n.id === 'n_click') &&
        d.groups.length === 1 && d.groups[0].id !== 'end' &&
        d.extras.length === 1 && d.extras[0] === 'direction LR', d);
      // 输入本身含关键字 id（`end` 当组 id），真 Mermaid 是拒收的 —— 这条验的是**产物**合法。
      const out = serializeDoc(d);
      check('组合语料：产物真 Mermaid 合法', (await accepts(out)).ok, out);
      check('组合语料：往返检查为空', roundTripDiff(d).length === 0, roundTripDiff(d));
    }

    console.log('\n[29] cleanId 归一撞名：两个写法都必须活下来（后写不许吃掉先写）');
    {
      // 三种写法都是真 Mermaid 认的合法 id（第 [24] 节语料里就有 `a.b` 与 `api-gateway`），
      // 它们归一后都是 `a_b`。从前 `ensureNode` 只按 id 去重 → 后写覆盖先写，
      // 用户写了两个节点、读回来一个，**零警告**。修法：给后来者加稳定后缀 + 出声。
      const d = parseMermaid('flowchart TD\n  a-b["甲"]\n  a.b["乙"]\n  a/b["丙"]');
      check('a-b / a.b / a/b 三个写法活成三个节点',
        d.nodes.length === 3, d.nodes.map(n => [n.id, n.label]));
      check('第一处保留归一结果 a_b，后来者拿稳定后缀 a_b_2 / a_b_3',
        d.nodes.map(n => n.id).join(',') === 'a_b,a_b_2,a_b_3', d.nodes.map(n => n.id));
      check('label 不互相覆盖（甲 / 乙 / 丙 各归各的）',
        d.nodes.map(n => n.label).join(',') === '甲,乙,丙', d.nodes.map(n => n.label));
      check('撞名必须出声（至少一条 warning 说明改了什么）',
        d.warnings.length === 2 && d.warnings.every(w => w.indexOf('撞名') >= 0), d.warnings);
      const out = serializeDoc(d);
      check('产物往返稳定（写出去再读回来不再分配新后缀）', serializeDoc(parseMermaid(out)) === out, out);
      check('产物往返检查为空', roundTripDiff(d).length === 0, roundTripDiff(d));
      check('产物真 Mermaid 合法', (await accepts(out)).ok, out);
      // 数字开头与自动生成的 n1 撞名（审计 13.1）：`1` 归一到 `n1`，与真有个 `n1` 撞
      const dn = parseMermaid('flowchart TD\n  1["甲"]\n  n1["乙"]');
      check('`1` 与真有个 `n1` 撞名时两条都活下来',
        dn.nodes.length === 2 && dn.nodes.map(n => n.id).join(',') === 'n1,n1_2', dn.nodes.map(n => [n.id, n.label]));
      check('`1` 与 `n1`：label 也不互相覆盖', dn.nodes.map(n => n.label).join(',') === '甲,乙', dn.nodes);
      check('`1` 与 `n1`：产物往返检查为空', roundTripDiff(dn).length === 0, roundTripDiff(dn));
      // **同一个原始写法**重复出现不算撞名：真 Mermaid 里那就是同一个节点，标签后写覆盖先写
      const ddup = parseMermaid('flowchart TD\n  a-b["甲"]\n  a-b["乙"]');
      check('同一个原始写法写两遍仍旧是一个节点（与真 Mermaid 同语义）',
        ddup.nodes.length === 1 && ddup.nodes[0].id === 'a_b' && ddup.nodes[0].label === '乙', ddup.nodes);
      check('同一个原始写法不产生撞名警告', ddup.warnings.length === 0, ddup.warnings);
      // `-` `.` `/` 这类**无损语义**的归一不许出声（第 [24] 节整段语料钉着这条）
      check('单纯的 a-b → a_b 归一不出声',
        parseMermaid('flowchart TD\n  a-b --> c').warnings.length === 0,
        parseMermaid('flowchart TD\n  a-b --> c').warnings);
      // 裸声明（没有形状没有标签）的标题取**原始写法**，不是归一后的 id
      check('裸声明的标题保留用户写的原始写法（api-gateway 不变成 api_gateway）',
        parseMermaid('flowchart TD\n  api-gateway --> db').nodes[0].label === 'api-gateway',
        parseMermaid('flowchart TD\n  api-gateway --> db').nodes[0]);
      // 注释（@pos / @link / @file）也必须按原始写法认回被改名的那个节点
      const dpos = parseMermaid([
        'flowchart TD',
        '  a-b["甲"]',
        '  a.b["乙"]',
        '%% @pos a-b 10 20',
        '%% @pos a.b 30 40',
        '%% @file a.b "src/b.ts"',
      ].join('\n'));
      const na = dpos.nodes.find(n => n.id === 'a_b');
      const nb = dpos.nodes.find(n => n.id === 'a_b_2');
      check('撞名的两条各自认回自己的 @pos（10,20 / 30,40）',
        !!na && !!nb && na.x === 10 && na.y === 20 && nb.x === 30 && nb.y === 40, [na, nb]);
      check('撞名的那个也能认回自己的 @file', !!nb && nb.files.join(',') === 'src/b.ts', nb && nb.files);
      check('撞名场景里不许有「注释指向不存在节点」的假警告',
        dpos.warnings.every(w => w.indexOf('指向图里不存在的节点') < 0), dpos.warnings);
    }

    console.log('\n[30] emoji（astral 平面）id：产物必须真 Mermaid 合法，label 里的 emoji 照旧合法');
    {
      // 代理对的两个码元都 ≥ \u00C0，从前的字符类把 `😀` 当合法 CJK 原样放行 ——
      // 写出去的 `🚀["发布"]` 真 Mermaid 直接 Lexical error，而我们零警告。
      for (const raw of ['😀', 'a😀', '😀a', '🚀x', 'x🚀', '𝕏']) {
        const d = parseMermaid('flowchart TD\n  ' + raw + '["发布"]');
        const out = serializeDoc(d);
        check('emoji id ' + JSON.stringify(raw) + '：产物真 Mermaid 合法', (await accepts(out)).ok,
          { err: (await accepts(out)).err, out });
        check('emoji id ' + JSON.stringify(raw) + '：节点没丢、label 是「发布」',
          d.nodes.length === 1 && d.nodes[0].label === '发布', d.nodes);
        check('emoji id ' + JSON.stringify(raw) + '：id 里不再有代理对码元',
          !/[\uD800-\uDFFF]/.test(d.nodes[0].id), d.nodes[0].id);
        check('emoji id ' + JSON.stringify(raw) + '：出声了（不许静默改写）',
          d.warnings.some(w => w.indexOf('emoji') >= 0), d.warnings);
        check('emoji id ' + JSON.stringify(raw) + '：往返稳定 + 检查为空',
          serializeDoc(parseMermaid(out)) === out && roundTripDiff(d).length === 0,
          { stable: serializeDoc(parseMermaid(out)) === out, diff: roundTripDiff(d) });
      }
      // label 里的 emoji 是内容，必须继续合法（第 [23] 节也钉着，这里留一条独立对照）
      const lbl = { direction: 'TD', summary: '', extras: [], groups: [], edges: [], nodes: [{ id: 'n1', label: '😀 发布 🚀', shape: 'rect', group: null, x: 0, y: 0, link: null, files: [] }] };
      check('label 里的 emoji 照旧合法', (await accepts(serializeDoc(lbl))).ok, serializeDoc(lbl));
      check('label 里的 emoji 往返不变', parseMermaid(serializeDoc(lbl)).nodes[0].label === '😀 发布 🚀');
      // 负向对照：原样写出去确实是真 Mermaid 拒收的（否则上面那些断言没牙）
      const badEmoji = await accepts('flowchart TD\n  🚀["发布"]');
      check('负向对照：emoji 原样当 id 确实被真 Mermaid 拒收', !badEmoji.ok, badEmoji);
    }

    console.log('\n[31] Mermaid 关键字表：候选逐个过真 mermaid.parse（含关键字 + 后缀）');
    {
      // 判据不是「cleanId 变了」而是**产物真的合法**：`call --> B` / `end中["L"]` 是实测的 Parse error。
      check('关键字表里有关键字（否则这一节是空测试）', Array.isArray(MERMAID_KEYWORD_LIST) && MERMAID_KEYWORD_LIST.length >= 14, MERMAID_KEYWORD_LIST);
      for (const kw of MERMAID_KEYWORD_LIST) {
        const d = parseMermaid('flowchart TD\n  ' + kw + '["L"]');
        const out = serializeDoc(d);
        const r = await accepts(out);
        check('关键字 ' + kw + ' 当节点 id：产物真 Mermaid 合法', r.ok, { err: r.err, out });
        check('关键字 ' + kw + ' 当节点 id：归一成 ' + cleanId(kw) + ' 且回读一致',
          d.nodes.length === 1 && d.nodes[0].id === cleanId(kw) &&
          parseMermaid(out).nodes.map(n => n.id).indexOf(cleanId(kw)) >= 0,
          { id: d.nodes.length === 1 ? d.nodes[0].id : null, want: cleanId(kw) });
        check('关键字 ' + kw + ' 当节点 id：往返检查为空', roundTripDiff(d).length === 0, roundTripDiff(d));
      }
      // 走连线的写法：`call --> B` 实测是真 Parse error（`call` 从前不在关键字表里）。
      // `style` / `class` / `classDef` / `linkStyle` 不在这组里：真 Mermaid 根本不允许它们
      // 当 id，我们按**真指令**处理（进 extras 原样保留），这是既有口径。
      const ARROW_FORM = ['end', 'graph', 'flowchart', 'subgraph', 'interpolate', 'call', 'href', 'link', 'click', 'direction'];
      for (const kw of ARROW_FORM) {
        const d = parseMermaid('flowchart TD\n  ' + kw + ' --> B');
        const out = serializeDoc(d);
        const r = await accepts(out);
        check('关键字 ' + kw + ' --> B：产物真 Mermaid 合法', r.ok, { err: r.err, out });
        check('关键字 ' + kw + ' --> B：节点、边、extras 都对',
          d.nodes.length === 2 && d.edges.length === 1 && d.extras.length === 0, { n: d.nodes.map(n => n.id), e: d.edges.length, x: d.extras });
        check('关键字 ' + kw + ' --> B：往返检查为空', roundTripDiff(d).length === 0, roundTripDiff(d));
      }
      // 关键字 + 后缀：真 Mermaid 的 lexer 见到前缀关键字就吃 token（`end中` 是 Parse error），
      // 所以「关键字 + 非 [A-Za-z0-9_] 后缀」必须一起归一。前两组后缀实测全是拒收。
      const SUFFIXES = ['中', 'δ', '😀', '中x', '-', '.', '/'];
      const KWS_WITH_SUFFIX = ['end', 'graph', 'flowchart', 'subgraph', 'style', 'class', 'classDef', 'linkStyle', 'interpolate'];
      for (const kw of KWS_WITH_SUFFIX) {
        for (const suf of SUFFIXES) {
          const raw = kw + suf;
          const d = parseMermaid('flowchart TD\n  ' + raw + '["L"]');
          const out = serializeDoc(d);
          const r = await accepts(out);
          check('关键字带后缀 ' + JSON.stringify(raw) + '：产物真 Mermaid 合法', r.ok, { err: r.err, out });
          check('关键字带后缀 ' + JSON.stringify(raw) + '：节点与 label 都在',
            d.nodes.length === 1 && d.nodes[0].label === 'L', d.nodes);
        }
      }
      // `link` / `click` / `direction` 是**允许**当 id 的（真 Mermaid 认），但它们同时是指令开头：
      // 闸门不许把 `link中["L"]` 判成指令吞掉（这正是文件无界增长的成因）。
      for (const raw of ['link中["L"]', 'click中["L"]', 'direction中["L"]', 'link["L"]', 'direction LR']) {
        const d = parseMermaid('flowchart TD\n  ' + raw);
        if (raw === 'direction LR') {
          check('subgraph 外的 direction LR 仍按指令处理（进 extras，不丢）',
            d.extras.length === 1 && d.extras[0] === 'direction LR', d.extras);
          continue;
        }
        check(raw + '：进模型（不被指令闸门吞掉）', d.nodes.length === 1 && d.extras.length === 0, { n: d.nodes.map(x => x.id), e: d.extras });
        check(raw + '：产物真 Mermaid 合法', (await accepts(serializeDoc(d))).ok, serializeDoc(d));
      }
      // 负向对照：这些原始写法确实被真 Mermaid 拒收 —— 证明上面的归一不是过度设计
      for (const bad of ['flowchart TD\n  end["L"]', 'flowchart TD\n  call --> B', 'flowchart TD\n  end中["L"]', 'flowchart TD\n  classDef中["L"]']) {
        const r = await accepts(bad);
        check('负向对照：' + JSON.stringify(bad.split('\n')[1].trim()) + ' 原样确实被拒收', !r.ok, r);
      }
    }

    console.log('\n[32] @pos 数值闸门：非有限 / 畸形数字必须出声，不许静默消失');
    {
      // 从前数值闸门是字符类 `-?[0-9.]+`：`.` 与 `1.2.3` 都能过，parseFloat 给出 NaN / 1.2，
      // NaN 到不了盘上（serializeDoc 有 isFinite），于是用户写的注释零警告消失、`1.2.3` 被改写成 `1`。
      // 而 roundTripDiff 也看不见它：JSON.stringify(NaN) === 'null' 恰好等于回读的 null。
      for (const badPos of ['. .', '1.2.3 4', '... 1', '1 ...', '1e5 2', '+1 2']) {
        const d = parseMermaid('flowchart TD\n  A["a"]\n%% @pos A ' + badPos);
        check('@pos A ' + badPos + '：出声（不许静默丢弃）',
          d.warnings.length === 1 && d.warnings[0].indexOf('@pos') >= 0, d.warnings);
        check('@pos A ' + badPos + '：坐标不落盘（宁可不写也不写个假的）',
          d.nodes[0].x === null && d.nodes[0].y === null, d.nodes[0]);
        check('@pos A ' + badPos + '：往返检查为空', roundTripDiff(d).length === 0, roundTripDiff(d));
      }
      // 合法写法一个都不许误伤（含 `.5` 这种省略整数部分的写法、整数、负数）
      for (const [good, x, y] of [['.5 .5', 0.5, 0.5], ['1.5 2.5', 1.5, 2.5], ['-1 -2', -1, -2], ['01 02', 1, 2], ['1 2', 1, 2]]) {
        const d = parseMermaid('flowchart TD\n  A["a"]\n%% @pos A ' + good);
        check('@pos A ' + good + '：收下且不出声',
          d.warnings.length === 0 && d.nodes[0].x === x && d.nodes[0].y === y, { w: d.warnings, n: d.nodes[0] });
      }
      // 尾部多余内容照收坐标、照出声（既有口径不许被这次改动带坏）
      const tail = parseMermaid('flowchart TD\n  A["a"]\n%% @pos A 1 2 尾巴');
      check('@pos 尾部多余内容：坐标照收 + 出声',
        tail.nodes[0].x === 1 && tail.nodes[0].y === 2 && tail.warnings.length === 1, { n: tail.nodes[0], w: tail.warnings });
      // stableJson 对非有限数字写哨兵：从前 NaN 与 null 写成同一个 'null'，检查继续瞎
      check('stableJson 区分 NaN 与 null（往返检查不再瞎）',
        stableJson({ x: NaN }) !== stableJson({ x: null }), { nan: stableJson({ x: NaN }), nul: stableJson({ x: null }) });
      check('stableJson 区分 Infinity 与 null',
        stableJson({ x: Infinity }) !== stableJson({ x: null }), { inf: stableJson({ x: Infinity }) });
      // 真的把 NaN 模型喂给往返检查：必须报出来（第 11 条「静默丢数据」的守门）
      const nanDoc = {
        direction: 'TD', summary: '', extras: [], groups: [], edges: [],
        nodes: [{ id: 'A', label: 'A', shape: 'rect', group: null, x: NaN, y: 0, link: null, files: [] }],
      };
      check('模型里有 NaN 坐标时往返检查会喊（从前它是安静的）',
        roundTripDiff(nanDoc).indexOf('nodes') >= 0, roundTripDiff(nanDoc));
    }

    console.log('\n[33] 重复组 id：serializeDoc 只写一块（成员行与 %% @pos 各一次）');
    {
      // 加载路径（openPath → adopt(parseMermaid(text))）从前不做组去重，模型里留着两个同 id 的组；
      // serializeDoc 每个组各写一遍成员行与 @pos/@link/@file，而往返检查因为「重解析还是两个组」
      // 判不出异常 —— 零警告地写出重复内容。修法：解析与序列化两处都保留第一条（与 normalizeModel 同口径）。
      const dupText = ['flowchart TD', '  subgraph g1["A 组"]', '    n1["一"]', '  end', '  subgraph g1["B 组"]', '    n2["二"]', '  end'].join('\n');
      const dp = parseMermaid(dupText);
      check('解析：重复的组 id 只留第一个组（label 取第一次的）',
        dp.groups.length === 1 && dp.groups[0].id === 'g1' && dp.groups[0].label === 'A 组', dp.groups);
      check('解析：重复组要出声', dp.warnings.some(w => w.indexOf('重复的组') >= 0), dp.warnings);
      check('解析：两个成员都还在、都挂在这个组上',
        dp.nodes.length === 2 && dp.nodes.every(n => n.group === 'g1'), dp.nodes);
      check('解析：往返稳定 + 检查为空',
        serializeDoc(parseMermaid(serializeDoc(dp))) === serializeDoc(dp) && roundTripDiff(dp).length === 0,
        { out: serializeDoc(dp), diff: roundTripDiff(dp) });
      const dupOut = serializeDoc(dp);
      check('解析产物：subgraph / 成员行 / @pos 各只出现一次',
        dupOut.split('\n').filter(l => l.indexOf('subgraph g1') >= 0).length === 1 &&
        dupOut.split('\n').filter(l => l.indexOf('n1[') >= 0).length === 1 &&
        dupOut.split('\n').filter(l => l.indexOf('n2[') >= 0).length === 1,
        dupOut);
      // 手搓一份「模型里真有两个同 id 的组」（界面/老模型可能这么发）：serializeDoc 也只写一块
      const handDoc = {
        direction: 'TD', summary: '', extras: [], edges: [],
        groups: [{ id: 'g1', label: 'A 组' }, { id: 'g1', label: 'B 组' }],
        nodes: [
          { id: 'n1', label: '一', shape: 'rect', group: 'g1', x: 1, y: 2, link: null, files: ['src/a.ts'] },
          { id: 'n2', label: '二', shape: 'rect', group: 'g1', x: 3, y: 4, link: null, files: [] },
        ],
      };
      const handOut = serializeDoc(handDoc);
      check('手搓重复组：subgraph 只写一块', handOut.split('\n').filter(l => l.indexOf('subgraph ') >= 0).length === 1, handOut);
      check('手搓重复组：成员行各一次', handOut.split('\n').filter(l => l.indexOf('n1[') >= 0).length === 1 && handOut.split('\n').filter(l => l.indexOf('n2[') >= 0).length === 1, handOut);
      check('手搓重复组：%% @pos / %% @file 各一次',
        handOut.split('\n').filter(l => l.indexOf('@pos n1') >= 0).length === 1 &&
        handOut.split('\n').filter(l => l.indexOf('@pos n2') >= 0).length === 1 &&
        handOut.split('\n').filter(l => l.indexOf('@file n1') >= 0).length === 1, handOut);
      check('手搓重复组：产物真 Mermaid 合法', (await accepts(handOut)).ok, handOut);
    }

    console.log('\n[34] 指令闸门与文件定点：`link中` 不许每一轮多出一行');
    {
      // 最小复现：`link中["L"]` 从前被指令闸门当指令塞进 extras，节点只能靠边活下来、label 退化成 id；
      // 重开时 `%% @pos` / `%% @file` 被当「指向不存在节点」丢掉，而 extras 那行每存一轮就多写一遍。
      const t1 = ['flowchart TD', '  subgraph A["组"]', '    link中["L"]', '  end', '  B --- link中'].join('\n') + '\n';
      const d1 = parseMermaid(t1);
      check('link中 进模型（不是 extras）', d1.nodes.some(n => n.id === 'n_link中') && d1.extras.length === 0,
        { n: d1.nodes.map(n => n.id), e: d1.extras });
      const nLink = d1.nodes.find(n => n.id === 'n_link中');
      check('link中 的 label 就是 L（不退化）', !!nLink && nLink.label === 'L', d1.nodes);
      const out1 = serializeDoc(d1);
      const out2 = serializeDoc(parseMermaid(out1));
      check('文本定点：第二遍与第一遍逐字节相同', out1 === out2, { out1, out2 });
      check('link中 的声明行只出现一次（从前每存一轮多一行）',
        out1.split('\n').filter(l => l.indexOf('n_link中[') >= 0).length === 1, out1);
      check('link中 的行数在一轮往返后不增长', out1.split('\n').length === out2.split('\n').length, { a: out1.split('\n').length, b: out2.split('\n').length });
      check('产物真 Mermaid 合法', (await accepts(out1)).ok, out1);
      // `@pos` / `@file` 指向 `link中` 时不许被当「不存在的节点」丢掉
      const withPos = parseMermaid([
        'flowchart TD',
        '  subgraph A["组"]',
        '    link中["L"]',
        '  end',
        '  B --- link中',
        '%% @pos link中 10 20',
        '%% @file link中 "src/x.ts"',
      ].join('\n'));
      const ln = withPos.nodes.find(n => n.id === 'n_link中');
      check('@pos link中 认回节点（坐标 10,20）', !!ln && ln.x === 10 && ln.y === 20, ln);
      check('@file link中 认回节点', !!ln && ln.files.join(',') === 'src/x.ts', ln && ln.files);
      check('link中 场景下没有「指向不存在节点」的假警告',
        withPos.warnings.every(w => w.indexOf('指向图里不存在的节点') < 0), withPos.warnings);
    }

    console.log('\n[35] ARROWS 是连接符的唯一真相（纯函数层）；宿主层那条在 host.e2e.mjs');
    {
      // ARROW_SET 从 ARROWS 派生（document.ts），这里只钉「ARROWS 里每一个都能被序列化器
      // 原样写出去、并经真 mermaid.parse」—— 宿主那一侧（normalizeModel / add_edge 会不会
      // 把它退成 `-->`）由 host.e2e.mjs 走 doc:set 落盘断言。
      check('ARROWS 至少 28 种', ARROWS.length >= 28, ARROWS.length);
      for (const arrow of ARROWS) {
        const doc = {
          direction: 'TD', summary: '', extras: [], groups: [],
          nodes: [
            { id: 'A', label: 'A', shape: 'rect', group: null, x: 0, y: 0, link: null, files: [] },
            { id: 'B', label: 'B', shape: 'rect', group: null, x: 0, y: 0, link: null, files: [] },
          ],
          edges: [{ id: 'e1', from: 'A', to: 'B', label: '', arrow: arrow }],
        };
        const text = serializeDoc(doc);
        const line = text.split('\n').filter(l => l.trim().indexOf('A ') === 0)[0];
        check('连接符 ' + arrow + '：序列化原样写出', line === '  A ' + arrow + ' B', { line });
        check('连接符 ' + arrow + '：产物真 Mermaid 合法', (await accepts(text)).ok, { text, err: (await accepts(text)).err });
        check('连接符 ' + arrow + '：往返后箭头不变', parseMermaid(text).edges[0].arrow === arrow, parseMermaid(text).edges);
      }
    }
  }

  endPhase();
})();
