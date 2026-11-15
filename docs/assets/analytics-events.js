/* Independent first-party events. The existing /analytics.js owns the CF beacon. */
(function () {
  'use strict';
  var script = document.currentScript;
  var EXCLUDE = 'haomin.analytics.exclude';
  var SESSION = 'cquisl.analytics.visit.v1';
  var SESSION_MS = 30 * 60 * 1000;
  var QUEUE_MS = 5 * 60 * 1000;
  var MAX_QUEUE = 40;
  var queue = [];
  var timer = null;
  var scanTimer = null;
  var flight = null;
  var stopped = false;
  var lastPath = null;
  var retry = 0;
  var sentOnPage = 0;
  var recent = [];
  var memorySession = null;
  var searches = new WeakMap();
  var pendingSearches = new Set();
  var dialogs = new Map();

  function excluded() {
    try { return window.localStorage.getItem(EXCLUDE) === '1'; }
    catch (_) { return true; } // If exclusion cannot be read, fail closed.
  }

  function path() {
    var value = window.location.pathname.replace(/\/+$/, '');
    if (value === '/cquisl') return '/cquisl/';
    if (/^\/cquisl\/(database|research|about)$/.test(value)) return value;
    if (/^\/cquisl\/cases\/c-\d{4}$/.test(value) && validCase(value.slice(14))) return value;
    return null; // Includes /cquisl/analytics/: the report never tracks itself.
  }

  function validCase(value) {
    return typeof value === 'string' && /^c-\d{4}$/.test(value) && +value.slice(2) > 0 && +value.slice(2) <= 306;
  }

  if (!script || window.__cquislAnalytics || window.location.hostname !== 'nnvvff.github.io' ||
      excluded() || !path() || typeof window.fetch !== 'function' || !window.crypto?.getRandomValues) return;
  var endpoint;
  try {
    endpoint = new URL(script.getAttribute('data-endpoint') || script.getAttribute('data-analytics-endpoint'));
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) return;
    endpoint = endpoint.href.replace(/\/+$/, '') + '/collect';
  } catch (_) { return; }
  var isTest = script.getAttribute('data-analytics-test') === '1' || window.navigator.webdriver === true ||
    new URLSearchParams(window.location.search).get('analytics_test') === '1';
  window.__cquislAnalytics = true;

  function uid() {
    if (typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    var bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, function (n) { return n.toString(16).padStart(2, '0'); }).join('');
  }

  function stop() {
    stopped = true;
    queue.length = 0;
    clearTimeout(timer);
    clearTimeout(scanTimer);
    pendingSearches.forEach(function (state) { clearTimeout(state.timer); });
    pendingSearches.clear();
    dialogs.clear();
    if (flight) flight.abort();
    if (observer) observer.disconnect();
  }

  function allowed() {
    if (stopped) return false;
    if (excluded()) { stop(); return false; }
    return Boolean(path());
  }

  function session(now) {
    var value = memorySession;
    try {
      var stored = window.localStorage.getItem(SESSION + (isTest ? '.test' : ''));
      if (stored && stored.length < 256) value = JSON.parse(stored);
    } catch (_) { /* Memory session still works when writing is unavailable. */ }
    if (!value || !/^[A-Za-z0-9_-]{16,64}$/.test(value.id || '') ||
        !Number.isFinite(value.last) || value.last > now || now - value.last >= SESSION_MS) {
      value = { id: uid(), last: now };
    }
    value.last = now;
    memorySession = value;
    try { window.localStorage.setItem(SESSION + (isTest ? '.test' : ''), JSON.stringify(value)); }
    catch (_) { /* A reload may start a new visit if storage is unavailable. */ }
    return value.id;
  }

  function schedule(delay) {
    if (!timer && !stopped) timer = setTimeout(function () { timer = null; void flush(false); }, delay);
  }

  function record(type, caseId) {
    if (!allowed() || sentOnPage >= 500) return;
    var now = Date.now();
    recent = recent.filter(function (time) { return now - time < 60000; });
    if (recent.length >= 60) return;
    recent.push(now);
    sentOnPage += 1;
    var visitId = session(now);
    var currentPath = path();
    // A visit is idempotent in D1, including reloads, route changes and batch retries.
    // Reassert it in every batch so a previous dropped/outage batch cannot lose the visit.
    var item = { id: uid(), type: type, path: currentPath };
    if (caseId) item.case_id = caseId;
    queue = queue.filter(function (entry) { return now - entry.queuedAt < QUEUE_MS; });
    if (queue.length >= MAX_QUEUE) queue.shift();
    queue.push({ event: item, visit: visitId, queuedAt: now });
    schedule(2000);
  }

  async function flush(leaving) {
    if (!allowed()) { queue.length = 0; return; }
    if (flight) return;
    var now = Date.now();
    queue = queue.filter(function (item) { return now - item.queuedAt < QUEUE_MS; });
    if (!queue.length) return;
    var visit = queue[0].visit;
    var batch = [];
    // One implicit visit + at most nine events keeps every request within the API cap.
    for (var i = 0; i < queue.length && batch.length < 9 && queue[i].visit === visit; i++) batch.push(queue[i]);
    var visitEvent = { id: 'visit_' + visit, type: 'visit', path: batch[0].event.path };
    var body = JSON.stringify({ site: 'cquisl', is_test: isTest, visit_id: visit,
      events: [visitEvent].concat(batch.map(function (item) { return item.event; })) });
    var controller = new AbortController();
    flight = controller;
    var timeout = setTimeout(function () { controller.abort(); }, 5000);
    try {
      if (!allowed()) return;
      var response = await window.fetch(endpoint, { method: 'POST', mode: 'cors', credentials: 'omit',
        referrerPolicy: 'no-referrer', headers: { 'Content-Type': 'application/json' },
        body: body, keepalive: Boolean(leaving), signal: controller.signal });
      if (response.ok || (response.status >= 400 && response.status < 500 && response.status !== 429)) {
        var completed = new Set(batch);
        queue = queue.filter(function (item) { return !completed.has(item); });
        retry = 0;
      } else retry += 1;
    } catch (_) { retry += 1; }
    finally {
      clearTimeout(timeout);
      flight = null;
      if (retry >= 3) { queue.length = 0; retry = 0; }
      if (queue.length && allowed()) schedule(retry ? Math.min(60000, 5000 * Math.pow(3, retry - 1)) : 1000);
    }
  }

  // The v102 public bundle renders the selected case in a Radix dialog h2. Exact
  // public titles map to IDs locally; neither headings nor case names are transmitted.
  var caseNames = {"c-0001":["科莫诉墨菲石油公司案","Comer v. Murphy Oil USA, Inc"],"c-0002":["关于适用《防止及惩治灭绝种族罪公约》的案件 （波黑诉塞尔维亚和黑山）","Application of the Convention on the Prevention and Punishment of the Crime of Genocide (Bosnia and Herzegovina v. Serbia and Montenegro)"],"c-0003":["维也纳机场扩建第三条跑道案","In re Vienna-Schwechat Airport Expansion"],"c-0004":["纽鲍尔诉德国案","Neubauer et v. Germany"],"c-0005":["乌尔根达诉荷兰案","Urgenda Foundation v. State of the Netherlands"],"c-0006":["哥伦比亚未来世代案","Demanda Generaciones Futuras v. Minambiente (Future Generations v. Ministry of the Environment and Others)"],"c-0007":["朱利安娜诉美国案","Juliana v. United States"],"c-0008":["地球之友诉荷兰皇家壳牌案","Milieudefensie et al. v. Royal Dutch Shell plc."],"c-0009":["萨乌尔·卢西亚诺·利尤亚诉德国RWE集团案","Luciano Lliuya v. RWE AG"],"c-0010":["韦丹塔资源有限公司（Vedanta）诉 Lungowe 案","Vedanta Resources PLC and another v. Lungowe and others"],"c-0011":["气候变化国家义务咨询意见","Obligations of States in respect of Climate Change"],"c-0012":["马萨诸塞州诉联邦环保局案","Massachusetts v. EPA"],"c-0013":["阿斯加尔・莱加里诉巴基斯坦共和国案","Asghar Leghari v. Federation of Pakistan"],"c-0014":["金道贤等诉韩国案","Do-Hyun Kim et al. v. South Korea"],"c-0015":["基瓦利纳诉埃克森美孚等案","Kivalina v. ExxonMobil Corporation et al."],"c-0016":["沙玛诉澳大利亚环境部长案","Sharma v. Minister for the Environment"],"c-0017":["挪威绿色和平组织诉石油能源部案","Greenpeace Nordic Ass’n v. Ministry of Petroleum and Energy (People v Arctic Oil)"],"c-0018":["爱尔兰环境之友诉爱尔兰政府案","Friends of the Irish Environment CLG v. The Government of Ireland"],"c-0019":["亚马逊研究协会诉巴西案","Institute of Amazonian Studies v. Brazil"],"c-0020":["我们所有人的案件及其他人诉法国案（“世纪之案”）","Notre Affaire à Tous and Others v. France ( L’Affaire du siècle)"],"c-0021":["气候诉讼协会诉比利时王国等人案","VZW Klimaatzaak v. Kingdom of Belgium & Others"],"c-0022":["美国电力公司诉康涅狄格州案","American Electric Power Co. v. Connecticut"],"c-0023":["自然之友诉国网甘肃省电力公司“弃风弃光”环境民事公益诉讼案","The Friends of Nature Institute v. Gansu State Grid"],"c-0024":["自然之友诉国网宁夏电力公司“弃风弃光”环境民事公益诉讼案","—"],"c-0025":["菲律宾非政府组织诉47家“碳巨头”案","In re Greenpeace Southeast Asia and Others"],"c-0026":["Sacchi等16名儿童诉阿根廷等五国案","Sacchi, et al. v. Argentina, et al."],"c-0027":["挑战加速处理儿童庇护案","The Door v. Edlow"],"c-0028":["墨西哥绿色和平组织诉能源部案","Greenpeace Mexico v. Ministry of Energy and Others (on the National Electric System policies)"],"c-0029":["因纽特人向美洲人权委员会请愿案","Petition to the Inter American Commission on Human Rights Seeking Relief from Violations Resulting from Global Warming Caused by Acts and Omissions of The United States"],"c-0030":["D.H. 等人诉捷克共和国案","D.H. and Others v. the Czech Republic"],"c-0031":["桑帕尼等人诉希腊案","Sampani and Others v. Greece"],"c-0032":["拉维达等人诉希腊案","Lavida and Others v. Greece"],"c-0033":["霍瓦特与基斯诉匈牙利案","Horváth and Kiss v. Hungary"],"c-0034":["尼赖吉哈佐诉讼案","The Nyíregyháza litigation"],"c-0035":["奥尔舒什等人诉克罗地亚案","Oršuš and Others v. Croatia"],"c-0036":["荷兰诉 H.K. 赤道几内亚第三国遣返案","Complaint against Equatorial Guinea concerning third-country deportations"],"c-0037":["什图卡图罗夫诉俄罗斯案","Shtukaturov v Russia"],"c-0038":["奥拉基诉奥巴马案（美国无人机打击人权案）","Al-Aulaqi v Obama"],"c-0039":["哈希耶夫与阿卡耶娃诉俄罗斯案","Khashiyev and Akayeva v Russia"],"c-0040":["希尔西・贾马等人诉意大利案","Hirsi Jamaa and Others v Italy"],"c-0041":["KH 等人诉斯洛伐克案","KH and Others v Slovakia"],"c-0042":["LH 诉拉脱维亚案","LH v Latvia"],"c-0043":["菲拉蒂加诉佩尼亚 - 伊拉拉案","Filártiga v Peña-Irala"],"c-0044":["奥利阿里等人诉意大利案","Oliari and Others v Italy"],"c-0045":["罗森多・坎图等人诉墨西哥案","Rosendo Cantú and Others v Mexico"],"c-0046":["费尔南德斯・奥尔特加等人诉墨西哥案","Fernández Ortega and Others v. Mexico"],"c-0047":["洛佩斯・索托等人诉委内瑞拉案","López Soto and Others v. Venezuela"],"c-0048":["莫利纳・泰森诉危地马拉案","Molina Theissen v Guatemala"],"c-0049":["公诉人诉雷耶斯・希龙与巴尔德斯・阿西格案（塞普尔・萨尔科案）","Ministerio Público v Reyes Girón and Valdez Asig (Sepur Zarco Case)"],"c-0050":["军事检察官诉巴图米克等人案（卡武穆案）","Auditeur Militaire v Batumike and Others (Kavumu Case)"],"c-0051":["反对暴力侵害妇女联盟等人诉总检察长等人案","Coalition on Violence Against Women and Others v Attorney General and Others"],"c-0052":["关于在西班牙实施的危害人类罪案（阿根廷诉状案）","In re Crimes against Humanity committed in Spain (Querella Argentina)"],"c-0053":["冈比亚诉缅甸案","Application of the Convention on the Prevention and Punishment of the Crime of Genocide (The Gambia v. Myanmar: 11 States intervening)"],"c-0054":["威胁或使用核武器的合法性咨询意见","Legality of the Threat or Use of Nuclear Weapons (Advisory Opinion)"],"c-0055":["罗珀诉西蒙斯案","Roper v Simmons"],"c-0056":["南非政府诉格鲁特布姆案","Government of South Africa v Grootboom"],"c-0057":["南非宗教自由协会诉司法部长案","Freedom of Religion South Africa v Minister of Justice (2019)"],"c-0058":["弗洛雷斯诉雷诺案（美国移民儿童拘留案）","Flores v Reno"],"c-0059":["米勒诉阿拉巴马州案（美国未成年人无假释终身监禁案）","Miller v Alabama"],"c-0060":["拉法基公司（Lafarge）涉嫌共谋反人类罪案","Sherpa, European Center for Constitutional and Human Rights (ECCHR) and 11 Syrian Employees v. Lafarge SA and Others"],"c-0061":["欧洲军火出口商涉嫌也门战争罪案","ECCHR et al. Communication to ICC concerning European arms exports to Yemen"],"c-0062":["唐纳德·拉姆斯菲尔德（Donald Rumsfeld）酷刑案","Center for Constitutional Rights et al. v. Donald Rumsfeld et al."],"c-0063":["苏丹前总统巴希尔（Al Bashir）未被逮捕案","Minister of Justice and Constitutional Development and Others v Southern African Litigation Centre and Others"],"c-0064":["新电视台/卡尔马・哈亚特藐视法庭案","New TV S.A.L. and Karma Mohamed Tahsin Al Khayat"],"c-0065":["贝鲁特新闻报/易卜拉欣・阿明藐视法庭案","Akhbar Beirut SAL and Ibrahim Mohamed Al Amin"],"c-0066":["阿根廷福特案","Causa N° 2855, caratulada como \"Müller, Pedro y otros s/privación ilegal de la libertad (Ford case)"],"c-0067":["希马里诉 CACI 案","Al-Shimari et al. v. CACI Premier Technology"],"c-0068":["在被占领巴勒斯坦领土修建隔离墙的法律后果（咨询意见）案","Legal Consequences of the Construction of a Wall in the Occupied Palestinian Territory (Advisory Opinion)"],"c-0069":["乌克兰诉俄罗斯（反恐融资/种族歧视公约案）","Application of the International Convention for the Suppression of the Financing of Terrorism and of the International Convention on the Elimination of All Forms of Racial Discrimination (Ukraine v Russian Federation)"],"c-0070":["格鲁吉亚诉俄罗斯（种族歧视公约案）","Application of the International Convention on the Elimination of All Forms of Racial Discrimination (Georgia v Russian Federation)"],"c-0071":["马绍尔群岛诉英国（核裁军义务案）","Obligations concerning Negotiations relating to Cessation of the Nuclear Arms Race and to Nuclear Disarmament (Marshall Islands v United Kingdom) (Preliminary Objections) "],"c-0072":["斯嘉丽扩展公司诉比利时作者、作曲家和出版商协会（SABAM）案","Scarlet Extended SA v Société belge des auteurs, compositeurs et éditeurs SCRL (SABAM)"],"c-0073":["艾伯塔省出口天然气税参考案","Reference re Exported Natural Gas Tax"],"c-0074":["在尼加拉瓜境内及针对尼加拉瓜的军事与准军事活动案","Military and Paramilitary Activities in and against Nicaragua (Nicaragua v United States of America)"],"c-0075":["加州诉通用汽车公司案","People of the State of California v. General Motors Corporation et al."],"c-0076":["南非母婴传播抗艾药物案","Minister of Health and Others v. Treatment Action Campaign and Others"],"c-0077":["塔佩拉等诉总检察长等案","Tapela, et al. v. Attorney General, et al."],"c-0078":["纳米比亚共和国政府诉 LM 等人案","Government of the Republic of  Namibia v LM and Others"],"c-0079":["乌干达纳卡塞克区健康权案","The Center for Health, Human Rights and Development and Others v Nakaseke District Local Administration"],"c-0080":["西蒙斯等人诉公共安全部长等人案","Simons et al. v. Minister of Public Safety et al."],"c-0081":["非洲约翰内斯堡地球生命组织诉环境事务部长案","EarthLife Africa Johannesburg v. Minister of Environmental Affairs and Others"],"c-0082":["菲律宾共和国诉中华人民共和国南海仲裁案","South China Sea (Philippines v China)"],"c-0083":["南方蓝鳍金枪鱼案","Southern Bluefin Tuna (New Zealand v. Japan; Australia v. Japan)"],"c-0084":["莫克斯工厂案","MOX Plant (Ireland v. United Kingdom)"],"c-0085":["大柔佛海峡填海造陆案","Land Reclamation in and around the Straits of Johor (Malaysia v. Singapore)"],"c-0086":["南非诉以色列案","Application of the Convention on the Prevention and Punishment of the Crime of Genocide in the Gaza Strip (South Africa v. Israel)"],"c-0087":["刘成昆、邹光祥寻衅滋事罪案","—"],"c-0088":["普劳曼诉欧洲经济共同体委员会案","Plaumann & Co. v Commission of the European Economic Community"],"c-0089":["华盛顿环境委员会诉贝隆案","Washington Environmental Council v. Bellon"],"c-0090":["盖伊·亚伯拉罕斯诉澳大利亚联邦银行","Guy Abrahams v. Commonwealth Bank of Australia"],"c-0091":["加州多地诉雪佛龙等大型公司系列案","Climate change litigation by California local governments against fossil fuel companies\n(e.g., County of San Mateo v. Chevron Corp.; County of Marin v. Chevron Corp.; New York v. BP plc)"],"c-0092":["美国保护法基金会诉埃克森美孚公司案","Conservation Law Foundation v. ExxonMobil Corp."],"c-0093":["史密斯诉恒天然集团案","Smith v. Fonterra Co-Operative Group Ltd"],"c-0094":["气候合法性网络等人诉意大利埃尼集团案","Rete Legalità per il Clima and others v. ENI"],"c-0095":["麦戈伊与戴维斯诉大学退休金计划有限公司案","McGaughey & Davies v. Universities Superannuation Scheme Ltd"],"c-0096":["新西兰学生气候解决方案组织等诉BP董事会案","NZ Students for Climate Solutions & UK Youth Climate Coalition v. Board of BP"],"c-0097":["科迪莉亚等人诉意大利案","Cordella and Others v. Italy"],"c-0098":["布朗诉教育委员会案","Brown v. Board of Education of Topeka"],"c-0099":["鲍威尔诉阿拉巴马州案","Powell v. Alabama"],"c-0100":["诺里斯诉阿拉巴马州案","Norris v. Alabama"],"c-0101":["亚当萨伊・卡比亚与 AdvocAid 组织诉塞拉利昂共和国童婚案","Kabia and Another v. Republic of Sierra Leone"],"c-0102":["郭玉珍损害商业信誉罪案（“奶农郭玉珍实名举报伊利案”）","—"],"c-0103":["弗雷泽诉萨尼奇案","Fraser v. Saanich"],"c-0104":["住宅权益开发公司等人诉克劳等人案","Home Equity Development Inc et al v Crow et al"],"c-0105":["德比郡案","Derbyshire County Council v Times Newspapers Ltd"],"c-0106":["埃廷斯豪森诉澳大利亚统一出版社案","Australian Consolidated Press Ltd v Ettingshausen"],"c-0107":["赫尔德诉蒙大拿州案","Held v. State of Montana"],"c-0108":["瑞士气候老年妇女协会等诉瑞士案","Verein KlimaSeniorinnen Schweiz and Others v. Switzerland"],"c-0109":["圣马特奥县案 / 雪佛龙气候诉讼案","County of San Mateo v. Chevron Corp."],"c-0110":["视觉中国黑洞照片版权争议事件","—"],"c-0111":["里奇诉德斯蒂法诺案","Ricci v. DeStefano"],"c-0112":["费舍尔诉大学录取没有一视同仁案","Fisher v. University of Texas"],"c-0113":["谢尔比县诉霍尔德案","Shelby County v.Holder"],"c-0114":["麦当劳诉格林案","McDonnell Douglas Corp. v. Green"],"c-0115":["普华永道诉霍普金斯案","Price Waterhouse v. Hopkins"],"c-0116":["阿斯玛・布格纳乌伊及人权辩护协会诉米克罗普尔股份公司案","Asma Bougnaoui and ADDH v. Micropole SA"],"c-0117":["科尔曼诉阿特里奇与史蒂夫律师事务所案","S. Coleman v. Attridge Law and Steve Law"],"c-0118":["哈南诉德国案","Hanan v. Germany"],"c-0119":["联邦情报局境外监视案","Federal Intelligence Service–foreign surveillance"],"c-0120":["N.D.与N.T.诉西班牙案","N.D. and N.T. v. Spain"],"c-0121":["ECCHR及巴勒斯坦人权组织诉德国武器出口案","ECCHR and Palestinian human rights organizations Sue to Stop German Weapons Exports to Israel"],"c-0122":["哈姆丹诉拉姆斯菲尔德案","Hamdan v. Rumsfeld"],"c-0123":["检察官诉伊尼亚斯・穆尔瓦纳夏卡、斯特拉顿・穆索尼案","Prosecutor v. Ignace Murwanashyaka & Straton Musoni"],"c-0124":["皮诺切特案（第三号）","R v Bow Street Metropolitan Stipendiary Magistrate, ex parte Pinochet Ugarte (No 3)"],"c-0125":["1965 年查戈斯群岛从毛里求斯分离的法律后果案（国际法院咨询意见案） 联动案件：（1）毛里求斯诉英国（查戈斯海洋保护区仲裁案）（2）毛里求斯诉马尔代夫案","Legal Consequences of the Separation of the Chagos Archipelago from Mauritius in 1965"],"c-0126":["尼加拉瓜诉德国案","Alleged Breaches of Certain International Obligations in respect of the Occupied Palestinian Territory (Nicaragua v. Germany)"],"c-0127":["范德维尔登诉荷兰案","Van der Velden v. the Netherlands"],"c-0128":["曼戈尔德案","Werner Mangold v Rüdiger Helm"],"c-0129":["多布斯诉杰克逊妇女健康组织案","Dobbs v. Jackson Women’s Health Organization"],"c-0130":["瑞典Lundin案件","Prosecutor v Ian Lundin and Alex Schneiter (Sweden, 2021)"],"c-0131":["Varvarin 大桥轰炸国家赔偿案","Families of Varvarin Civilian Victims v. Federal Republic of Germany"],"c-0132":["布拉日奇等人诉塞尔维亚案","Blažić and Others v. Serbia"],"c-0133":["安瓦尔・R. 案（科布伦茨案)","Anwar R. v. Germany (In the case of crimes against the State)"],"c-0134":["塔拉赫尔诉瑞士案","Tarakhel v. Switzerland"],"c-0135":["沙里菲等人诉意大利与希腊案","Sharifi and Others v. Italy & Greece"],"c-0136":["联合国苏丹问题专家小组 2021 年最终报告","Panel of Experts on the Sudan Final Report"],"c-0137":["约安尼斯・马西昂托尼诉希腊案","Ioannis Mathiantonis v. Greece"],"c-0138":["吉利恩与昆顿诉英国案","Gillan and Quinton v. United Kingdom"],"c-0139":["伊朗局势调查请求案（ECCHR诉伊朗官员案）","Criminal Complaint on the Situation in Iran (ECCHR v. Iranian Officials)"],"c-0140":["白·洛案（德国联邦总检察长 诉 白·洛 案）","The Bai Lowe Case (The Federal Prosecutor General v. Bai L.)"],"c-0141":["帕里岛居民诉豪瑞公司案","Arif Pujianto and others v. Holcim AG"],"c-0142":["密苏里州等诉美国食品药品监督管理局案","State of Missouri et al. v. U.S. Food and Drug Administration et al."],"c-0143":["帕拜与保罗诉澳大利亚联邦案（托雷斯海峡岛民案）","Pabai Pabai and Guy Paul Kabai v. Commonwealth of Australia"],"c-0144":["环境青年组织诉加拿大案（加拿大青年气候诉讼案）","ENVironnement JEUnesse v. Procureur général du Canada"],"c-0145":["拉罗斯诉加拿大案（加拿大青年气候案）","La Rose v. Canada"],"c-0146":["马瑟等诉安大略省案（安大略青年气候诉讼案）","Mathur et al. v. Ontario"],"c-0147":["捷克气候诉讼案 (气候案例协会诉捷克政府案)","Klimatická žaloba ČR v. Czech Republic"],"c-0148":["卡瓦略等人诉欧洲议会和理事会案（“人民气候诉讼案”）","Armando Carvalho and Others v. European Parliament and the Council"],"c-0149":["大桑特市诉法国政府案","Commune de Grande-Synthe v. France"],"c-0150":["德国农民气候案(或德国农民诉德国联邦政府案)","Family Farmers and Greenpeace Germany v. Germany"],"c-0151":["利迪玛·潘戴诉印度政府案（印度青少年气候案）","Ridhima Pandey v. Union of India"],"c-0152":["意大利“最后的审判”气候案(A Sud等诉意大利政府案)","A Sud et al. v. Italy (Giudizio Universale)"],"c-0153":["墨西哥青年气候诉讼案(或青年诉墨西哥政府案)","Youth v. Government of Mexico"],"c-0154":["什雷斯塔诉尼泊尔政府案（尼泊尔气候变化法案）","Shrestha v. Office of the Prime Minister et al."],"c-0155":["汤姆森诉气候变化事务部长案（新西兰首例气候诉讼案）","Thomson v. Minister for Climate Change Issues"],"c-0156":["阿尔瓦雷斯等人诉秘鲁案（秘鲁亚马逊气候案）","Álvarez et al. v. Peru"],"c-0157":["波兰空气质量案 (或 M.G. 诉波兰财政部案)","ClientEarth v. Poland (on behalf of M.G.)"],"c-0158":["西班牙绿色和平组织等诉西班牙政府案","Greenpeace et al. v. Spain"],"c-0159":["地球之友等诉英国政府案（英国净零战略案）","R (oao Friends of the Earth) v. Secretary of State for Business Energy and Industrial Strategy"],"c-0160":["施雷姆斯 II 案","Data Protection Commissioner v. Facebook Ireland and Maximillian Schrems"],"c-0161":["阿拉斯加州诉努纳皮楚克原住民村","State v. Native Village of Nunapitchuk"],"c-0162":["六月医疗服务公司诉菲利普斯","June Med. Servs. LLC v. Phillips"],"c-0163":["前进蒙大拿州组织诉蒙大拿州政府","Forward Mont. v. State"],"c-0164":["罗伊・惠特利监护案","Conservatorship of Whitley"],"c-0165":["约书亚・S 收养案","Adoption of Joshua S."],"c-0166":["巴尔的摩市长诉阿扎尔","Mayor of Baltimore v. Azar"],"c-0167":["人权无神论者协会诉华盛顿县","Atheists for Human Rights v. County of Wash"],"c-0168":["关于 JTI - 麦克唐纳公司复议案","JTI-Macdonald Corp., Re"],"c-0169":["不列颠哥伦比亚省法语学校委员会诉不列颠哥伦比亚省","Conseil scolaire francophone de la Colombie-Britannique v British Columbia"],"c-0170":["人类尊严信托诉英格兰及威尔士慈善委员会","Human Dignity Trust v Charity Commission for England and Wales"],"c-0171":["SC 诉就业与养老金大臣","R (on the application of SC) v Secretary of State for Work and Pensions"],"c-0172":["特里・让・贝德福德、艾米・勒博维奇、瓦莱丽・斯科特诉加拿大总检察长","Terri Jean Bedford, Amy Lebovitch and Valerie Scott v Attorney General of Canada"],"c-0173":["加拿大原住民儿童与家庭关爱协会诉加拿大总检察长","First Nations Child and Family Caring Society of Canada v Attorney General of Canada"],"c-0174":["M 诉 H（匿名案件）","M v H. (Ontario Registrar General Intervener)"],"c-0175":["英国英美烟草（英国）有限公司及其他诉卫生大臣","R (on the application of British American Tobacco (UK) Ltd) and Others v Secretary of State for Health"],"c-0176":["女王诉埃吉古","R v Ejigu"],"c-0177":["女王诉柯克帕特里克","R v Kirkpatrick"],"c-0178":["俄罗斯航空运营商保险政策索赔管辖权申请案","Re Russian Aircraft Operator Policy Claims (Jurisdiction Applications)"],"c-0179":["不列颠哥伦比亚省出庭律师协会诉不列颠哥伦比亚省（总检察长）","Trial Lawyers Association of British Columbia v British Columbia (Attorney General)"],"c-0180":["小姐妹图书艺术商场诉加拿大（海关与税务署署长）","Little Sisters Book And Art Emporium v Canada (Commissioner of Customs And Revenue Agency)"],"c-0181":["W 诉伯明翰市议会","R (on the application of W) v Birmingham City Council"],"c-0182":["Waorani对冲PetroOriental气候变化案","Baihua Caiga et al. v. PetroOriental S.A."],"c-0183":["乌克兰诉俄罗斯联邦《防止及惩治灭绝种族罪公约》适用案（灭绝种族指控案）","Allegations of Genocide under the Convention on the Prevention and Punishment of the Crime of Genocide (Ukraine v. Russian Federation)"],"c-0184":["RJR - 麦克唐纳公司诉加拿大总检察长","RJR-MacDonald Inc. v. Attorney General of Canada"],"c-0185":["格鲁特诉布林格、格拉茨诉布林格（合并）","Grutter v. Bollinger; Gratz v. Bollinger"],"c-0186":["1704604 安大略有限公司诉庞茨保护协会","Leonela Zelaya et al. v. Honduras"],"c-0187":["索斯温德诉加拿大","Southwind v. Canada"],"c-0188":["纽芬兰与拉布拉多省（总检察长）诉乌阿沙努阿特（乌阿沙哈特及马尼乌特纳姆因努人）案","Newfoundland and Labrador (Attorney General) v. Uashaunnuat (Innu of Uashat and of Mani-Utenam)"],"c-0189":["阿尔塞纳 - 卡梅伦等及爱德华王子岛父母联合会诉爱德华王子岛政府及加拿大总检察长等案","Noella Arsenault-Cameron, Madeleine Costa-Petitpas and the Federation des Parents de l'Ile-du-Prince-Edouard Inc. v. the Government of Prince Edward Island and the Attorney General of Canada et al."],"c-0190":["加拿大残疾人理事会诉加拿大维亚铁路公司案","Council of Canadians with Disabilities v. VIA Rail Canada Inc."],"c-0191":["海达民族诉不列颠哥伦比亚省（林业部长）案","Haida Nation v. British Columbia (Minister of Forests)"],"c-0192":["加拿大矿业观察组织诉渔业与海洋部部长、自然资源部部长及加拿大总检察长案","MiningWatch Canada v. Minister of Fisheries and Oceans, Minister of Natural Resources and Attorney General of Canada"],"c-0193":["博克斯诉印第安纳州和肯塔基州计划生育协会案","Box v. Planned Parenthood of Indiana and Kentucky, Inc."],"c-0194":["科尔多瓦诉克莱因等案","Cordova v. Cline"],"c-0195":["权利与平等直接行动组织诉美国联邦通信委员会案","Direct Action for Rights and Equality v. FCC (In re MCP 191)"],"c-0196":["坡诉德拉蒙德等案","Poe v. Drummond"],"c-0197":["难民与移民教育法律服务中心诉马伦案","Refugee & Immigrant Ctr. for Educ. & Legal Servs. v. Mullin"],"c-0198":["公平录取学生组织诉哈佛学院院长及同仁案","Students for Fair Admissions, Inc. v. President & Fellows of Harv. Coll."],"c-0199":["布朗诉亚利桑那州及亚利桑那大学董事会案","Brown v. Arizona"],"c-0200":["能源转移公司诉吉恩法官及绿色和平组织案","Energy Transfer LP v. Gion"],"c-0201":["多元文化同一讯息组织诉克莱门茨等人案","Many Cultures, One Message v. Clements"],"c-0202":["德拉蒙德公司诉科林沃斯案","Drummond Co., Inc. v. Collingsworth"],"c-0203":["Fashion 21 诉洛杉矶人道移民权利联盟案","Fashion 21 v. Coalition for Humane Immigrant Rights of Los Angeles"],"c-0204":["罗伯特・F・肯尼迪人权中心等诉美国国务院等案","Robert F. Kennedy Human Rights, et al. v. Department of State, et al."],"c-0205":["美国诉瓦尔廷・瑙塔、卡洛斯・德・奥利韦拉案","United States of America v. Waltine Nauta and Carlos De Oliveira"],"c-0206":["卡罗尔独立学区诉美国教育部案","Carroll Indep. Sch. Dist. v. United States Dep't of Educ."],"c-0207":["马萨诸塞州联邦诉埃克森美孚公司案","Commonwealth v. Exxon Mobil Corp."],"c-0208":["登顿诉布朗斯米尔开发公司案","Denton v. Browns Mill Dev. Co."],"c-0209":["北达科他州诉美国内政部案","North Dakota v. United States Department of the Interior"],"c-0210":["美国教师教育院校协会诉麦克马洪案","Am. Ass'n of Colls. for Tchr. Educ. v. McMahon"],"c-0211":["查尔斯 H 等人诉哥伦比亚特区案","Charles H. v. D.C."],"c-0212":["赫斯泰德诉苏圣玛丽市案","Hjerstedt v. City of Sault Ste. Marie"],"c-0213":["凯瑟琳 M 等人诉赖德案","Katherine M. v. Ryder"],"c-0214":["李等人诉华盛顿州案","Lee v. State"],"c-0215":["梅萨诉波塔莱斯市政学校教育委员会案","Meza v. Bd. of Educ. of the Portales Mun. Schs."],"c-0216":["佩尔多莫诉诺姆案","Perdomo v. Noem"],"c-0217":["萨拉查诉哥伦比亚特区案","Salazar v. District of Columbia"],"c-0218":["美国诉密歇根州及密歇根州惩教部案","United States v. State of Michigan and Michigan Department of Corrections"],"c-0219":["萨拉查诉圣胡安县拘留中心案","Salazar v. San Juan Cnty. Det. Ctr."],"c-0220":["里德诉罗兹案","Reed v. Rhodes"],"c-0221":["P.P. 等人诉康普顿联合学区案","P.P. v. Compton Unified Sch. Dist."],"c-0222":["全国临时保护身份联盟诉诺姆案","Nat'l TPS All. v. Noem"],"c-0223":["麦克唐纳诉朗利案","McDonald v. Longley"],"c-0224":["约翰逊诉沃特金案","Johnson v. Watkin"],"c-0225":["关于无名氏儿童权益案","In re Interest of Doe Children"],"c-0226":["霍克县教育委员会诉北卡罗来纳州案","Hoke Cty. Bd. of Educ. v. State"],"c-0227":["埃尔南德斯诉格里沙姆案","Hernandez v. Grisham"],"c-0228":["哈克莱斯诉赫斯特德案","Harkless v. Husted"],"c-0229":["格雷罗诉加利福尼亚州惩教与康复部案","Guerrero v. Cal. Dep't of Corr. & Rehab."],"c-0230":["弗赖哈特诉美国移民与海关执法局案","Fraihat v. United States Immigration & Customs Enforcement"],"c-0231":["埃文斯诉芬蒂案","Evans v. Fenty"],"c-0232":["欧洲联络旅行社公司诉冈萨雷斯案","European Connections & Tours, Inc. v. Gonzales"],"c-0233":["柯林诉拉芬斯珀格案","Curling v. Raffensperger"],"c-0234":["动物法律保护基金诉凯利案","Animal Legal Def. Fund v. Kelly"],"c-0235":["布朗斯米尔开发公司诉登顿案","Browns Mill Dev. Co. v. Denton"],"c-0236":["坎普诉亚基马 HMA 有限责任公司案","Campeau v. Yakima HMA, LLC"],"c-0237":["家乡地产公司诉弗莱明案","Hometown Props. v. Fleming"],"c-0238":["国际船长、大副与领航员组织诉美国国家劳资关系委员会案","Int'l Org. of Masters v. Nat'l Labor Relations Bd."],"c-0239":["新泽西州等诉特朗普案","New Jersey v. Trump"],"c-0240":["圣胡安县诉美国政府案","San Juan County v. United States"],"c-0241":["赫伯特・沙伊布勒诉巴登 - 符腾堡州案","Herbert Schaible v Land Baden-Württemberg (C-101/12)"],"c-0242":["肯尼亚财政规划部长诉奥科伊蒂等案","Cabinet Secretary for the National Treasury and Planning v Okoiti and others"],"c-0243":["雷德尔等诉矿产 sands 资源公司案","Reddell and others v Mineral Sands Resources (Pty) Ltd and others"],"c-0244":["奥伦古鲁马诉总检察长案","Olengurumwa v Attorney General"],"c-0245":["米图 - 贝尔福利协会诉肯尼亚机场管理局案","Mitu-Bell Welfare Society v Kenya Airports Authority and others"],"c-0246":["欧洲民主与自由法官协会诉欧盟理事会案","Magistrats européens pour la démocratie et les libertés (Medel) v Council of the European Union"],"c-0247":["1704604 安大略有限公司诉波因特保护协会案","1704604 Ontario Ltd. v. Pointes Protection Association"],"c-0248":["叙利亚医院遭俄罗斯空军袭击受害者诉俄罗斯联邦案","Victims of a Russian Air-force Attack on a Syrian Hospital v. Russian Federation (before UN Human Rights Committee)"],"c-0249":["叙利亚化学武器袭击案法国刑事调查","French Criminal Investigation of Chemical Weapons Attacks in Syria (civil party complaint by OSJI, Syrian survivors, SCM, and Syrian Archive)"],"c-0250":["叙利亚化学武器袭击案德国刑事调查","German Criminal Investigation into Chemical Weapons Attacks in Syria (criminal complaint by OSJI, Syrian Archive, and SCM)"],"c-0251":["安妮・波利纳等人诉澳大利亚气候人权案","Poelina et al. v. Australia"],"c-0252":["叙利亚化学武器袭击案瑞典刑事调查","Swedish Criminal Investigation of Chemical Weapons Attacks in Syria (criminal complaint by OSJI and partner organizations)"],"c-0253":["开放社会正义倡议诉美国中央情报局（CIA）等案","Open Society Justice Initiative v. Central Intelligence Agency (CIA) et al."],"c-0254":["老大哥观察组织诉英国政府案","Big Brother Watch v. United Kingdom"],"c-0255":["阿尔 - 纳什里诉罗马尼亚案","Al-Nashiri v. Romania"],"c-0256":["以色列国家检察官诉 “打破沉默” 组织案","State Attorney of Israel v. Breaking the Silence"],"c-0257":["阿尔 - 瓦希德诉英国国防部案","Al-Waheed and Ministry of Defence"],"c-0258":["埃特克斯巴里亚诉西班牙案","Etxebarria v. Spain"],"c-0259":["埃尔 - 沙卡维诉阿拉伯埃及共和国案","El Sharkawi v. Arab Republic of Egypt"],"c-0260":["人权监测研究所诉立陶宛共和国案","Human Rights Monitoring Institute v. Republic of Lithuania"],"c-0261":["茹雷克诉波兰案","Żurek v. Poland"],"c-0262":["贝德纳尔雷克等人诉波兰案","Bednarek and Others v. Poland"],"c-0263":["M.K. 等人诉波兰案","M.K. and Others v. Poland"],"c-0264":["爱尔兰诉英国案","Ireland v. the United Kingdom"],"c-0265":["卡卢杰罗维奇诉黑山案","Kaludjerovic v. Montenegro"],"c-0266":["文蒂拉等人诉罗马尼亚案","Vintila and Others v. Romania"],"c-0267":["托雷斯诉西班牙案","Torres v. Spain"],"c-0268":["基拉尔茨与范德吕尔诉荷兰气候抗议权案","Keularts and van der Luer v. the Netherlands"],"c-0269":["住房权：其含义及我们如何加强它","Right to Housing: Its Meaning and How We Strengthen It (GFF strategic litigation on social housing quota)"],"c-0270":["都柏林体系遣返入室案","Wohnungsbetretung zwecks Überstellung im Dublin III-Verfahren)"],"c-0271":["庇护者住所搜查案","Asylum Seeker Accommodation Search Case"],"c-0272":["环境事务部长诉基础工作信托临时受托人及其他人案","Minister of Environmental Affairs v the Trustees for the time being of Groundwork Trust and Others"],"c-0273":["第 206/2022 号集体申诉 —— 国际儿童保护协会及其他人诉西班牙案","Defence for Children International (DCI) and Others v. Spain"],"c-0274":["关于气候紧急状态与人权的第 32/25 号咨询意见","Advisory Opinion 32/25 on the Climate Emergency and Human Rights"],"c-0275":["特伦甘纳邦诉穆罕默德・阿卜杜勒・卡西姆案","State of Telangana v. Mohd. Abdul Qasim"],"c-0276":["损害赔偿请求案","Compensation for Damage (Others) [Plaintiffs v. State of Japan]"],"c-0277":["残疾人权利联盟诉新斯科舍省（总检察长）案","Disability Rights Coalition v. Nova Scotia (Attorney General)"],"c-0278":["陈某诉王某案","Chen v. Wang"],"c-0279":["埃尔・阿尤比与埃尔・阿祖安・阿祖兹诉西班牙案","El Ayoubi and El Azouan Azouz v. Spain"],"c-0280":["米莉森特・奥武尔・奥穆亚与玛格丽特・安约索・奥利莱诉总检察长及其他 4 人案","Millicent Awuor Omuya and Margaret Anyoso Oliele v. The Attorney General & 4 Others"],"c-0281":["M.C. 梅塔及另案告诉人诉印度联邦及其他与施里拉姆食品化肥工业公司案","M.C. Mehta and Anr. v. Union of India & Ors. & Shriram Foods and Fertiliser Industries"],"c-0282":["加拿大反贫困组织诉加拿大总检察长案","Canada Without Poverty v. Attorney General of Canada"],"c-0283":["第 588/15 号来文：少数群体权利国际组织及环境资源与发展组织（代表刚果（金）卡胡兹 - 别加国家公园巴图瓦族）诉刚果民主共和国案","Communication 588/15 Minority Rights Group International and Environnement Ressources Naturelles et Développement (on behalf of the Batwa of Kahuzi-Biega National Park, DRC) v. Democratic Republic of Congo (DRC)"],"c-0284":["儿童法律中心等诉基础教育部长及其他案","Centre for Child Law and Others v. Minister of Basic Education and Others"],"c-0285":["麦穆娜・阿卜杜勒穆米尼诉尼日利亚联邦、卡齐纳州政府及监狱局案","Maimuna Abdulmumini v. Federal Republic of Nigeria, Katsina State Government and the Nigerian Prison Service"],"c-0286":["努比亚未成年人诉肯尼亚案","Nubian Minors v. Kenya"],"c-0287":["HC 诉英国内政大臣及另一被告案","The Queen on the Application of HC (a child, by his litigation friend CC) v. The Secretary of State for the Home Department and Another"],"c-0288":["费鲁兹婴儿诉澳大利亚移民与边境保护部长案","Baby Ferouz v. Minister for Immigration and Border Protection"],"c-0289":["弗洛莫诉凡世通天然橡胶公司案","Flomo v. Firestone Natural Rubber Co LLC"],"c-0290":["奥基夫诉爱尔兰案","O’Keeffe v. Ireland"],"c-0291":["美国自然资源保护委员会诉伯古姆案","NRDC v. Burgum"],"c-0292":["婴儿 A（由母亲代理）及儿童基金会诉总检察长、肯雅塔国家医院、出生和死亡登记局案","Baby ‘A’ (suing through the mother, EA) and The CRADLE-the Children Foundation v. The Attorney General, Kenyatta National Hospital and the Registrar of Births and Deaths"],"c-0293":["比勒陀利亚大学人权中心及非洲人权保护大会诉塞内加尔","Centre for Human Rights, University of Pretoria and La Rencontre Africaine pour la Defense des Droits de L'Homme v. Senegal"],"c-0294":["APPROACH 诉比利时、塞浦路斯、捷克、法国、爱尔兰、意大利、斯洛文尼亚案","APPROACH v. Belgium, Cyprus, Czech Republic, France, Ireland, Italy, Slovenia"],"c-0295":["精神残疾倡导中心诉保加利亚案","Mental Disability Advocacy Centre (MDAC) v. Bulgaria"],"c-0296":["佐伊、斯特拉・福斯特等人诉华盛顿州生态部","Zoe and Stella Foster, et al. v. Washington Department of Ecology"],"c-0297":["挑战 1994 年《普通教育法》第 183 条合宪性案","Constitutional Challenge to Article 183 of the General Education Law 1994"],"c-0298":["舒库尔・阿里诉孟加拉国案","Shukur Ali v. Bangladesh"],"c-0299":["L.C. 诉秘鲁案","L.C. v. Peru"],"c-0300":["INTERIGHTS 诉克罗地亚案","INTERIGHTS v. Croatia"],"c-0301":["巴尔加斯・阿雷科诉巴拉圭案","Vargas Areco v. Paraguay"],"c-0302":["法律资源中心代表瓦伦丁・坎佩亚努诉罗马尼亚案","Center for Legal Resources on behalf of Valentin Câmpeanu v. Romania"],"c-0303":["西利亚丁诉法国案","Siliadin v. France"],"c-0304":["萨维尼诉乌克兰案","Saviny v. Ukraine"],"c-0305":["L. 和 V. 诉奥地利案；S.L. 诉奥地利案","L. and V. v. Austria; S.L. v. Austria"],"c-0306":["意大利绿色和平组织等诉埃尼集团、意大利经济财政部及存款贷款银行案","Greenpeace Italy et al. v. ENI S.p.A. et al."]};
  function normalize(value) { return (value || '').normalize('NFKC').replace(/\s+/g, ''); }
  var nameToId = new Map();
  Object.keys(caseNames).forEach(function (id) {
    caseNames[id].forEach(function (name) {
      var key = normalize(name);
      if (!key) return;
      nameToId.set(key, nameToId.has(key) && nameToId.get(key) !== id ? null : id);
    });
  });
  caseNames = null;

  function modalId(modal) {
    if (!modal || modal.hidden || modal.getAttribute('aria-hidden') === 'true' ||
        modal.getAttribute('data-state') === 'closed' || !modal.isConnected || !modal.getClientRects().length) return null;
    var heading = modal.querySelector('h2, [data-slot="dialog-title"]');
    if (!heading) return null;
    var explicit = modal.getAttribute('data-case-id');
    return validCase(explicit) ? explicit : nameToId.get(normalize(heading.textContent)) || null;
  }

  function scan() {
    scanTimer = null;
    if (!allowed()) { dialogs.clear(); return; }
    var present = new Map();
    document.querySelectorAll('[role="dialog"], [data-slot="dialog-content"], [data-case-modal]').forEach(function (modal) {
      var id = modalId(modal);
      if (!id) return;
      present.set(modal, id);
      if (dialogs.get(modal) !== id) record('case_open', id);
    });
    dialogs = present;
  }

  function scheduleScan() {
    if (!stopped && !scanTimer) scanTimer = setTimeout(scan, 100);
  }

  function route() {
    var current = path();
    if (!current) {
      queue.length = 0;
      lastPath = null;
      dialogs.clear();
      return;
    }
    if (current !== lastPath) { lastPath = current; record('pageview'); }
    scheduleScan();
  }

  function searchbox(target) {
    return target?.matches?.('input[type="search"], input[role="searchbox"]') ? target : null;
  }

  function stateFor(input) {
    var state = searches.get(input);
    if (!state) { state = { seq: 0, recorded: -1, timer: null }; searches.set(input, state); }
    return state;
  }

  function search(input) {
    var state = stateFor(input);
    clearTimeout(state.timer);
    pendingSearches.delete(state);
    if (!allowed() || !input.isConnected || !input.value.trim() || state.recorded === state.seq) return;
    state.recorded = state.seq;
    record('search');
  }

  document.addEventListener('input', function (event) {
    var input = searchbox(event.target);
    if (!input || event.isTrusted === false || !allowed()) return;
    var state = stateFor(input);
    state.seq += 1;
    clearTimeout(state.timer);
    pendingSearches.delete(state);
    if (path() !== '/cquisl/database' || !input.value.trim()) return;
    pendingSearches.add(state);
    state.timer = setTimeout(function () { search(input); }, 800);
  }, true);
  document.addEventListener('keydown', function (event) {
    var input = searchbox(event.target);
    if (input && event.key === 'Enter' && !event.isComposing && event.isTrusted !== false) search(input);
  }, true);
  document.addEventListener('submit', function (event) {
    if (event.isTrusted === false) return;
    var input = event.target.querySelector?.('input[type="search"], input[role="searchbox"]');
    if (input) search(input);
  }, true);

  function documentClick(event) {
    if ((event.type === 'click' && event.button !== 0) ||
        (event.type === 'auxclick' && event.button !== 1) || event.isTrusted === false || !allowed()) return;
    var anchor = event.target.closest?.('a[href]');
    if (!anchor) return;
    var url;
    try { url = new URL(anchor.getAttribute('href'), window.location.href); } catch (_) { return; }
    if (!['https:', 'http:'].includes(url.protocol)) return;
    var modal = anchor.closest('[role="dialog"], [data-slot="dialog-content"], [data-case-modal]');
    var id = modalId(modal);
    var isPdf = /\.(pdf|docx?|odt|rtf)(?:$|\/)/i.test(url.pathname);
    if (isPdf || (id && (url.origin !== window.location.origin || anchor.target === '_blank'))) {
      record('document_open', id || undefined);
      void flush(true);
    }
  }
  document.addEventListener('click', documentClick, true);
  document.addEventListener('auxclick', documentClick, true);
  window.addEventListener('storage', function (event) { if (event.key === EXCLUDE && excluded()) stop(); });
  window.addEventListener('popstate', route);
  window.addEventListener('pageshow', function (event) { if (event.persisted) { lastPath = null; route(); } });
  window.addEventListener('pagehide', function () { void flush(true); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') void flush(true);
    else route();
  });
  ['pushState', 'replaceState'].forEach(function (method) {
    var original = window.history[method];
    window.history[method] = function () {
      var result = original.apply(this, arguments);
      route();
      return result;
    };
  });
  var observer = typeof MutationObserver === 'function' ? new MutationObserver(scheduleScan) : null;
  if (observer && document.body) observer.observe(document.body, { childList: true, subtree: true,
    characterData: true, attributes: true, attributeFilter: ['data-state', 'hidden', 'aria-hidden', 'open', 'data-case-id'] });
  route();
})();
