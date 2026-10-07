// ═══════════════════════════════════════════════
// ─── Glossary: แนวนิยาย (Genre preset) · AI วิเคราะห์คลังศัพท์ ───
// ═══════════════════════════════════════════════
// 1) GENRE_PRESETS — ชุดคำศัพท์ตามแนว (นำเข้าคลังแบบเลือกได้) + แนวทางการแปลตามแนว (แทรกใน prompt แปล/สกัดคำ/วิเคราะห์)
//    เลือกแนวต่อ workspace ที่ ws.settings.genrePreset · คำในชุดอิงสำนวนที่ฉบับแปลไทยใช้กันแพร่หลาย ช่อง note บอกคำทางเลือก
// 2) AI วิเคราะห์คลังศัพท์ — ตรวจความสอดคล้อง / ความถูกต้อง / เสนอคำแปลที่เป็นไปได้ · เลือกโมเดลจากอันดับตามภาษาต้นฉบับ

// [ต้นฉบับ, ไทย, type, gender, note]
const GENRE_PRESETS = [
  {
    id: 'ko-murim', lang: 'ko', name: 'เกาหลี · มู่หลิน/ยุทธภพ (무협)',
    desc: 'นิยายกำลังภายในฉบับเกาหลี เช่น ภูเขาฮวาซาน, ยอดฝีมือกลับชาติ — ศัพท์วรยุทธแปลตามสำนวนกำลังภายในไทย ชื่อเฉพาะถอดเสียงเกาหลี',
    guide: `• Use the established Thai นิยายกำลังภายใน register: narration slightly literary; characters address each other ข้า/เจ้า, ท่าน; elders/masters speak with authority.
• Proper names in Korean murim novels are Sino-Korean: ALWAYS transliterate the KOREAN reading, never re-read them in Mandarin or use the old Hokkien-era Thai names — people (청명 → ชองมยอง), families (남궁세가 → ตระกูลนัมกุง), sects and places (화산파 → สำนักฮวาซาน · 소림 → โซริม · 무당 → มูดัง · 아미 → อามี · 당가 → ตระกูลดัง · 사천 → ซาชอน, not เสฉวน).
• Compound surnames (Korean reading): 제갈 เจกัล · 사마 ซามา · 구양 กูยาง · 상관 ซังกวาน · 남궁 นัมกุง · 모용 โมยง · 황보 ฮวังโบ · 동방 ดงบัง · 서문 ซอมุน · 독고 ทกโก · 장손 จังซน · 영호 ยองโฮ.
• Names that are plain descriptions are translated, not transliterated: 개방 พรรคกระยาจก · 마교 พรรคมาร · 무림맹 พันธมิตรยุทธภพ.
• Martial terms are translated by meaning, never transliterated: 내공 พลังภายใน · 단전 ตันเถียน · 경공 วิชาตัวเบา · 초식 กระบวนท่า · 검기 ปราณกระบี่ · 주화입마 ธาตุไฟเข้าแทรก.
• Realm names (일류/절정/초절정/화경/현경) are ranks: render them as ขั้น… and keep them identical every time.
• 사형/사제/사저/사매 follow the gender of the person: ศิษย์พี่/ศิษย์น้อง (male) · ศิษย์พี่หญิง/ศิษย์น้องหญิง (female).`,
    terms: [
      ['무림', 'ยุทธภพ', 'place', '', 'murim — โลกของผู้ฝึกยุทธ์'], ['강호', 'ยุทธจักร', 'place', '', 'kangho'],
      ['무공', 'วรยุทธ', 'term', '', 'martial arts'], ['내공', 'พลังภายใน', 'term', '', 'internal energy'],
      ['내력', 'กำลังภายใน', 'term', '', 'inner strength'], ['진기', 'ปราณแท้', 'term', '', 'true qi'],
      ['단전', 'ตันเถียน', 'term', '', 'dantian — บางเล่มใช้ จุดตันเถียน'], ['혈도', 'จุดชีพจร', 'term', '', 'acupoint'],
      ['점혈', 'สกัดจุด', 'skill', '', 'acupoint strike'], ['경공', 'วิชาตัวเบา', 'skill', '', 'lightness skill'],
      ['심법', 'เคล็ดวิชาลมปราณ', 'skill', '', 'mental cultivation method'], ['초식', 'กระบวนท่า', 'term', '', 'technique form'],
      ['검법', 'วิชากระบี่', 'skill', '', 'sword art'], ['검기', 'ปราณกระบี่', 'skill', '', 'sword qi'],
      ['검강', 'รัศมีกระบี่', 'skill', '', 'sword gang — ขั้นสูงกว่าปราณกระบี่'], ['전음', 'ส่งเสียงด้วยลมปราณ', 'skill', '', 'voice transmission'],
      ['주화입마', 'ธาตุไฟเข้าแทรก', 'term', '', 'qi deviation — สำนวนคลาสสิกของนิยายกำลังภายในไทย'], ['환골탈태', 'ผลัดกระดูกเปลี่ยนกาย', 'term', '', 'bone/body rebirth'],
      ['고수', 'ยอดฝีมือ', 'title', '', 'master/expert'], ['일류', 'ขั้นชั้นหนึ่ง', 'rank', '', 'first-rate'],
      ['절정', 'ขั้นสุดยอด', 'rank', '', 'peak realm'], ['초절정', 'ขั้นเหนือสุดยอด', 'rank', '', 'transcendent'],
      ['화경', 'ขั้นแปรสภาพ', 'rank', '', 'hwa-gyeong'], ['현경', 'ขั้นลึกล้ำ', 'rank', '', 'hyeon-gyeong'],
      ['정파', 'ฝ่ายธรรมะ', 'clan', '', 'orthodox faction'], ['사파', 'ฝ่ายอธรรม', 'clan', '', 'unorthodox faction'],
      ['마교', 'พรรคมาร', 'clan', '', 'demonic cult'], ['무림맹', 'พันธมิตรยุทธภพ', 'clan', '', 'murim alliance'],
      ['구파일방', 'เก้าสำนักหนึ่งพรรค', 'clan', '', 'nine sects one gang'], ['소림', 'โซริม', 'clan', '', 'Shaolin — ฉบับเสียงจีน: เส้าหลิน'],
      ['무당', 'มูดัง', 'clan', '', 'Wudang — ฉบับเสียงจีน: บู๊ตึ๊ง'], ['아미', 'อามี', 'clan', '', 'Emei — ฉบับเสียงจีน: ง้อไบ๊'],
      ['화산파', 'สำนักฮวาซาน', 'clan', '', 'Mount Hua sect — ฉบับเสียงจีน: หัวซาน'], ['개방', 'พรรคกระยาจก', 'clan', '', 'Beggars\' Sect'],
      ['남궁세가', 'ตระกูลนัมกุง', 'clan', '', 'Namgung family'], ['제갈세가', 'ตระกูลเจกัล', 'clan', '', 'Zhuge family'],
      ['모용세가', 'ตระกูลโมยง', 'clan', '', 'Murong family'], ['당가', 'ตระกูลดัง', 'clan', '', 'Tang family (사천당가)'],
      ['세가', 'ตระกูล', 'term', '', 'noble martial family'],
      ['장문인', 'เจ้าสำนัก', 'title', '', 'sect leader'], ['사부', 'ท่านอาจารย์', 'honorific', '', 'master/teacher'],
      ['사형', 'ศิษย์พี่', 'honorific', '', 'senior brother'], ['사제', 'ศิษย์น้อง', 'honorific', '', 'junior brother'],
      ['사저', 'ศิษย์พี่หญิง', 'honorific', '', 'senior sister'], ['사매', 'ศิษย์น้องหญิง', 'honorific', '', 'junior sister'],
      ['대협', 'ท่านจอมยุทธ์', 'honorific', '', 'great hero'], ['소협', 'จอมยุทธ์หนุ่ม', 'honorific', '', 'young hero (male)'],
      ['낭자', 'แม่นาง', 'honorific', '', 'young lady (female)'], ['공자', 'คุณชาย', 'honorific', '', 'young master (male)'],
    ],
  },
  {
    id: 'ko-hunter', lang: 'ko', name: 'เกาหลี · ฮันเตอร์/ระบบ/ย้อนเวลา',
    desc: 'โลกปัจจุบันมีเกตและดันเจี้ยน ระบบเกม หน้าต่างสถานะ การย้อนเวลา (회귀) — สำนวนแบบเว็บตูน/ไลต์โนเวลไทย',
    guide: `• Modern, brisk Thai prose; dialogue sounds like contemporary Korean speech rendered in natural Thai (ผม/ฉัน/นาย/เธอ, ครับ/ค่ะ by gender).
• Game/system vocabulary that Thai readers already know stays as Thai loanwords: สกิล · เลเวล · เควสต์ · ดันเจี้ยน · เกต · กิลด์ · เรด · มานา.
• Ranks keep the Latin letter: S급 → แรงก์ S · E급 헌터 → ฮันเตอร์แรงก์ E. Numbers in stats stay as digits.
• System messages / status windows keep their bracket style from the source ([ ] or 『 』) and are translated in a crisp, game-like tone.
• 회귀 is regression to the past (การย้อนเวลา / ย้อนกลับมา); 환생 is reincarnation (กลับชาติมาเกิด); 빙의 is waking up inside someone else's body (เข้าร่าง) — do not mix them up.
• Skill and item names: translate the meaning when it is Korean, transliterate when it is an English loanword in the source.`,
    terms: [
      ['헌터', 'ฮันเตอร์', 'title', '', 'hunter'], ['각성자', 'ผู้ตื่นพลัง', 'title', '', 'awakened — บางเล่มใช้ ผู้ตื่นรู้'],
      ['각성', 'การตื่นพลัง', 'term', '', 'awakening'], ['게이트', 'เกต', 'place', '', 'gate'],
      ['던전', 'ดันเจี้ยน', 'place', '', 'dungeon'], ['던전 브레이크', 'ดันเจี้ยนเบรก', 'term', '', 'dungeon break — ดันเจี้ยนแตก'],
      ['레이드', 'เรด', 'term', '', 'raid'], ['길드', 'กิลด์', 'clan', '', 'guild'],
      ['헌터 협회', 'สมาคมฮันเตอร์', 'clan', '', 'Hunter Association'], ['상태창', 'หน้าต่างสถานะ', 'term', '', 'status window'],
      ['스탯', 'ค่าสถานะ', 'term', '', 'stat'], ['스킬', 'สกิล', 'term', '', 'skill'],
      ['레벨 업', 'เลเวลอัป', 'term', '', 'level up'], ['경험치', 'ค่าประสบการณ์', 'term', '', 'EXP'],
      ['퀘스트', 'เควสต์', 'term', '', 'quest'], ['시스템', 'ระบบ', 'term', '', 'the System'],
      ['마석', 'หินเวท', 'item', '', 'mana stone'], ['마나', 'มานา', 'term', '', 'mana'],
      ['몬스터', 'มอนสเตอร์', 'monster', '', 'monster'], ['보스', 'บอส', 'monster', '', 'boss'],
      ['랭커', 'แรงเกอร์', 'title', '', 'ranker'], ['탑', 'หอคอย', 'place', '', 'the Tower'],
      ['회귀', 'การย้อนเวลา', 'term', '', 'regression — ย้อนกลับมาในอดีต'], ['회귀자', 'ผู้ย้อนเวลา', 'title', '', 'regressor'],
      ['환생', 'การกลับชาติมาเกิด', 'term', '', 'reincarnation'], ['빙의', 'การเข้าร่าง', 'term', '', 'possession/transmigration into a body'],
      ['성좌', 'กลุ่มดาว', 'title', '', 'constellation (sponsor) — บางเล่มใช้ ดวงดาว'], ['성흔', 'ตราดาว', 'term', '', 'stigma (from constellation)'],
      ['힐러', 'ฮีลเลอร์', 'title', '', 'healer'], ['탱커', 'แทงก์', 'title', '', 'tanker'],
      ['딜러', 'ดีลเลอร์', 'title', '', 'damage dealer'],
    ],
  },
  {
    id: 'ko-romance-fantasy', lang: 'ko', name: 'เกาหลี · โรแมนซ์แฟนตาซี/ราชสำนักยุโรป (로판)',
    desc: 'จักรวรรดิ ตระกูลขุนนาง สังคมชั้นสูง นางเอกเกิดใหม่/เข้าร่าง — ยศขุนนางแบบยุโรปทับศัพท์',
    guide: `• Elegant, courtly Thai: nobles speak politely and indirectly; servants and knights use deferential speech (ขอรับ/เจ้าค่ะ or ครับ/ค่ะ as the established style).
• Royal register: addressing the emperor/empress or crown prince uses ฝ่าบาท; male speakers end with พ่ะย่ะค่ะ, female speakers with เพคะ (light ราชาศัพท์ — do not overdo full Thai royal vocabulary).
• European noble ranks are transliterated, never mapped to Thai noble ranks: 공작 ดยุก · 후작 มาร์ควิส · 백작 เคานต์ · 자작 ไวเคานต์ · 남작 บารอน · 대공 แกรนด์ดยุก. Their wives: ดัชเชส · มาร์เชอเนส · เคาน์เตส.
• 영애 (noble daughter) → คุณหนู; 영식 (noble son) → คุณชาย; "<family> 공작가" → ตระกูลดยุก<family>.
• Keep European-sounding names in natural Thai transliteration (아델라이드 → อาเดเลด) and use one spelling throughout.`,
    terms: [
      ['황제', 'จักรพรรดิ', 'title', '', 'emperor'], ['황후', 'จักรพรรดินี', 'title', '', 'empress (consort)'],
      ['황태자', 'มกุฎราชกุมาร', 'title', '', 'crown prince'], ['황태자비', 'พระชายามกุฎราชกุมาร', 'title', '', 'crown princess'],
      ['황자', 'องค์ชาย', 'title', '', 'imperial prince'], ['황녀', 'องค์หญิง', 'title', '', 'imperial princess'],
      ['폐하', 'ฝ่าบาท', 'honorific', '', 'Your Majesty'], ['전하', 'ฝ่าบาท', 'honorific', '', 'Your Highness (เชื้อพระวงศ์) — บางเล่มใช้ องค์ชาย/องค์หญิง ตามเพศ'],
      ['대공', 'แกรนด์ดยุก', 'title', '', 'grand duke'], ['공작', 'ดยุก', 'title', '', 'duke — ราชบัณฑิตเขียน ดุ๊ก, บางเล่มใช้ ดยุค'],
      ['후작', 'มาร์ควิส', 'title', '', 'marquis'], ['백작', 'เคานต์', 'title', '', 'count/earl'],
      ['자작', 'ไวเคานต์', 'title', '', 'viscount'], ['남작', 'บารอน', 'title', '', 'baron'],
      ['공작부인', 'ดัชเชส', 'title', '', 'duchess'], ['후작부인', 'มาร์เชอเนส', 'title', '', 'marchioness'],
      ['백작부인', 'เคาน์เตส', 'title', '', 'countess'], ['영애', 'คุณหนู', 'honorific', '', 'noble daughter'],
      ['영식', 'คุณชาย', 'honorific', '', 'noble son'], ['공녀', 'ท่านหญิง', 'title', '', "duke's daughter"],
      ['가주', 'ประมุขตระกูล', 'title', '', 'family head'], ['영지', 'ดินแดน', 'place', '', 'fief/territory'],
      ['영주', 'เจ้าครองแคว้น', 'title', '', 'lord of the territory'], ['기사', 'อัศวิน', 'title', '', 'knight'],
      ['기사단', 'คณะอัศวิน', 'clan', '', 'knight order'], ['기사단장', 'ผู้บัญชาการคณะอัศวิน', 'title', '', 'knight commander'],
      ['신전', 'วิหาร', 'place', '', 'temple'], ['성녀', 'นักบุญหญิง', 'title', '', 'saintess'],
      ['사교계', 'สังคมชั้นสูง', 'term', '', 'high society'], ['데뷔탕트', 'งานเปิดตัวสู่สังคม', 'term', '', 'debutante ball'],
      ['시녀', 'นางกำนัล', 'title', '', 'lady-in-waiting'], ['하녀', 'สาวใช้', 'title', '', 'maid'],
      ['집사', 'พ่อบ้าน', 'title', '', 'butler'], ['마탑', 'หอเวท', 'place', '', 'magic tower'],
    ],
  },
  {
    id: 'zh-xianxia', lang: 'zh', name: 'จีน · เซียนเซีย/บำเพ็ญเซียน (仙侠·修真·玄幻)',
    desc: 'การบำเพ็ญเพียร ขั้นพลัง ศิลาวิญญาณ ค่ายกล โอสถ — ระบบขั้นแบบที่ฉบับแปลไทยใช้กันทั่วไป',
    guide: `• Thai จีนกำลังภายใน/เซียน register: ข้า/เจ้า for peers and juniors, ท่าน for seniors; narration slightly classical but readable.
• Names: Thai transliteration from Mandarin (林动 → หลินต้ง), one spelling throughout.
• Cultivation realms are ranks rendered as ขั้น…: 炼气 ขั้นหลอมปราณ · 筑基 ขั้นสร้างรากฐาน · 金丹 ขั้นแก่นทองคำ · 元婴 ขั้นวิญญาณก่อกำเนิด · 化神 ขั้นแปลงเทพ. "X期/X境" adds nothing — 筑基期 = ขั้นสร้างรากฐาน.
• 修炼/修行 → บำเพ็ญเพียร; 修士 → ผู้บำเพ็ญเพียร; 道友 → สหายเต๋า; 前辈 → ท่านผู้อาวุโส; 师尊/师父 → ท่านอาจารย์.
• Treasures, pills and formations are translated by meaning: 法宝 ศาสตราวิเศษ · 丹药 โอสถ · 阵法 ค่ายกล · 灵石 ศิลาวิญญาณ.
• Idioms (成语) are rendered naturally, never word by word.`,
    terms: [
      ['修炼', 'บำเพ็ญเพียร', 'term', '', 'cultivate'], ['修士', 'ผู้บำเพ็ญเพียร', 'title', '', 'cultivator'],
      ['炼气', 'ขั้นหลอมปราณ', 'rank', '', 'Qi Refining — บางเล่มใช้ ขั้นหลอมรวมปราณ'], ['筑基', 'ขั้นสร้างรากฐาน', 'rank', '', 'Foundation Establishment'],
      ['金丹', 'ขั้นแก่นทองคำ', 'rank', '', 'Golden Core'], ['元婴', 'ขั้นวิญญาณก่อกำเนิด', 'rank', '', 'Nascent Soul — บางเล่มใช้ ขั้นจิตก่อกำเนิด'],
      ['化神', 'ขั้นแปลงเทพ', 'rank', '', 'Spirit Severing/Deity Transformation'], ['渡劫', 'ขั้นฝ่าทัณฑ์', 'rank', '', 'Tribulation Transcendence'],
      ['大乘', 'ขั้นมหายาน', 'rank', '', 'Great Ascension'], ['天劫', 'ทัณฑ์สวรรค์', 'term', '', 'heavenly tribulation'],
      ['飞升', 'เหินสู่แดนเซียน', 'term', '', 'ascension'], ['灵气', 'ปราณวิญญาณ', 'term', '', 'spiritual qi'],
      ['灵根', 'รากวิญญาณ', 'term', '', 'spiritual root'], ['灵石', 'ศิลาวิญญาณ', 'item', '', 'spirit stone'],
      ['丹田', 'ตันเถียน', 'term', '', 'dantian'], ['神识', 'สัมผัสวิญญาณ', 'term', '', 'divine sense'],
      ['法宝', 'ศาสตราวิเศษ', 'item', '', 'magic treasure'], ['飞剑', 'กระบี่เหิน', 'item', '', 'flying sword'],
      ['丹药', 'โอสถ', 'item', '', 'pill/elixir'], ['炼丹', 'ปรุงโอสถ', 'skill', '', 'alchemy'],
      ['阵法', 'ค่ายกล', 'skill', '', 'formation'], ['秘境', 'แดนลับ', 'place', '', 'secret realm'],
      ['妖兽', 'สัตว์อสูร', 'monster', '', 'demonic beast'], ['魔修', 'ผู้บำเพ็ญมาร', 'title', '', 'demonic cultivator'],
      ['天道', 'วิถีสวรรค์', 'term', '', 'Heavenly Dao'], ['宗门', 'สำนัก', 'clan', '', 'sect'],
      ['掌门', 'เจ้าสำนัก', 'title', '', 'sect head'], ['长老', 'ผู้อาวุโส', 'title', '', 'elder'],
      ['道友', 'สหายเต๋า', 'honorific', '', 'fellow Daoist'], ['前辈', 'ท่านผู้อาวุโส', 'honorific', '', 'senior'],
      ['师尊', 'ท่านอาจารย์', 'honorific', '', 'master'], ['师兄', 'ศิษย์พี่', 'honorific', '', 'senior brother'],
      ['师姐', 'ศิษย์พี่หญิง', 'honorific', '', 'senior sister'], ['师弟', 'ศิษย์น้อง', 'honorific', '', 'junior brother'],
      ['师妹', 'ศิษย์น้องหญิง', 'honorific', '', 'junior sister'],
    ],
  },
  {
    id: 'zh-wuxia', lang: 'zh', name: 'จีน · กำลังภายในคลาสสิก (武侠)',
    desc: 'ยุทธจักร สำนักดัง วิชาตัวเบา สกัดจุด — สำนวนนิยายกำลังภายในไทยยุคคลาสสิก',
    guide: `• Classic Thai นิยายกำลังภายใน style: ข้า/เจ้า/ท่าน, ผู้น้อย for humble self-reference (在下), terse heroic dialogue.
• Famous sects keep their classic Thai (Hokkien-era) names: 少林 เส้าหลิน · 武当 บู๊ตึ๊ง · 峨眉 ง้อไบ๊ · 丐帮 พรรคกระยาจก. Other names: Thai transliteration from Mandarin, one spelling throughout.
• Martial terms translated by meaning: 内力 กำลังภายใน · 轻功 วิชาตัวเบา · 点穴 สกัดจุด · 走火入魔 ธาตุไฟเข้าแทรก · 招式 กระบวนท่า.
• 江湖 ยุทธจักร, 武林 บู๊ลิ้ม — keep whichever the glossary already uses.`,
    terms: [
      ['江湖', 'ยุทธจักร', 'place', '', 'jianghu'], ['武林', 'บู๊ลิ้ม', 'place', '', 'wulin — บางเล่มใช้ ยุทธภพ'],
      ['内力', 'กำลังภายใน', 'term', '', 'internal force'], ['真气', 'ลมปราณ', 'term', '', 'true qi'],
      ['轻功', 'วิชาตัวเบา', 'skill', '', 'lightness skill'], ['点穴', 'สกัดจุด', 'skill', '', 'acupoint strike'],
      ['穴道', 'จุดชีพจร', 'term', '', 'acupoint'], ['走火入魔', 'ธาตุไฟเข้าแทรก', 'term', '', 'qi deviation'],
      ['招式', 'กระบวนท่า', 'term', '', 'move/form'], ['剑法', 'วิชากระบี่', 'skill', '', 'sword art'],
      ['掌法', 'วิชาฝ่ามือ', 'skill', '', 'palm art'], ['剑气', 'ปราณกระบี่', 'skill', '', 'sword qi'],
      ['秘籍', 'คัมภีร์', 'item', '', 'secret manual'], ['大侠', 'ท่านจอมยุทธ์', 'honorific', '', 'great hero'],
      ['少侠', 'จอมยุทธ์หนุ่ม', 'honorific', '', 'young hero'], ['女侠', 'จอมยุทธ์หญิง', 'honorific', '', 'heroine'],
      ['帮主', 'ประมุขพรรค', 'title', '', 'gang leader'], ['少林', 'เส้าหลิน', 'clan', '', 'Shaolin'],
      ['武当', 'บู๊ตึ๊ง', 'clan', '', 'Wudang'], ['峨眉', 'ง้อไบ๊', 'clan', '', 'Emei'],
      ['丐帮', 'พรรคกระยาจก', 'clan', '', "Beggars' Sect"], ['魔教', 'พรรคมาร', 'clan', '', 'demonic cult'],
      ['正派', 'ฝ่ายธรรมะ', 'clan', '', 'orthodox'], ['邪派', 'ฝ่ายอธรรม', 'clan', '', 'unorthodox'],
      ['镖局', 'สำนักคุ้มภัย', 'clan', '', 'escort agency'], ['客栈', 'โรงเตี๊ยม', 'place', '', 'inn'],
      ['在下', 'ผู้น้อย', 'honorific', '', 'humble "I"'], ['姑娘', 'แม่นาง', 'honorific', '', 'young lady'],
      ['公子', 'คุณชาย', 'honorific', '', 'young master'],
    ],
  },
  {
    id: 'en-fantasy', lang: 'en', name: 'อังกฤษ · แฟนตาซีตะวันตก/LitRPG',
    desc: 'ดาบและเวทมนตร์ กิลด์นักผจญภัย ระบบเลเวล (Royal Road/LitRPG) — ทับศัพท์คำเกมที่คนไทยคุ้น',
    guide: `• Natural Thai fantasy prose; restructure English sentences, avoid "ถูก…" passives and literal "มัน" for people.
• Game/LitRPG terms Thai readers know stay as loanwords: เลเวล · สกิล · คลาส · เควสต์ · ดันเจี้ยน · กิลด์ · มานา; stat names (STR, AGI, HP, MP) stay in Latin letters.
• Status screens / system prompts keep their bracket formatting and numbers exactly.
• Noble ranks are transliterated: Duke ดยุก · Marquis มาร์ควิส · Earl เอิร์ล · Count เคานต์ · Viscount ไวเคานต์ · Baron บารอน; Your Majesty → ฝ่าบาท.
• Fantasy races: Elf เอลฟ์ · Dwarf ดวอร์ฟ · Orc ออร์ค · Goblin ก็อบลิน; Demon Lord → จอมมาร, Hero → ผู้กล้า.`,
    terms: [
      ['Status Window', 'หน้าต่างสถานะ', 'term', '', 'status screen'], ['Level', 'เลเวล', 'term', '', 'level'],
      ['Skill', 'สกิล', 'term', '', 'skill'], ['Class', 'คลาส', 'term', '', 'class'],
      ['Quest', 'เควสต์', 'term', '', 'quest'], ['Dungeon', 'ดันเจี้ยน', 'place', '', 'dungeon'],
      ['Guild', 'กิลด์', 'clan', '', 'guild'], ['Adventurers Guild', 'กิลด์นักผจญภัย', 'clan', '', "Adventurers' Guild"],
      ['Adventurer', 'นักผจญภัย', 'title', '', 'adventurer'], ['Mana', 'มานา', 'term', '', 'mana'],
      ['Experience', 'ค่าประสบการณ์', 'term', '', 'EXP'], ['Mage', 'จอมเวท', 'title', '', 'mage'],
      ['Demon Lord', 'จอมมาร', 'title', '', 'demon lord'], ['Hero', 'ผู้กล้า', 'title', '', 'hero (chosen)'],
      ['Saintess', 'นักบุญหญิง', 'title', '', 'saintess'], ['Knight', 'อัศวิน', 'title', '', 'knight'],
      ['Duke', 'ดยุก', 'title', '', 'duke'], ['Marquis', 'มาร์ควิส', 'title', '', 'marquis'],
      ['Earl', 'เอิร์ล', 'title', '', 'earl'], ['Count', 'เคานต์', 'title', '', 'count'],
      ['Viscount', 'ไวเคานต์', 'title', '', 'viscount'], ['Baron', 'บารอน', 'title', '', 'baron'],
      ['Your Majesty', 'ฝ่าบาท', 'honorific', '', 'address to a monarch'], ['Elf', 'เอลฟ์', 'monster', '', 'elf'],
      ['Dwarf', 'ดวอร์ฟ', 'monster', '', 'dwarf — บางเล่มใช้ คนแคระ'], ['Orc', 'ออร์ค', 'monster', '', 'orc'],
      ['Goblin', 'ก็อบลิน', 'monster', '', 'goblin'], ['Dragon', 'มังกร', 'monster', '', 'dragon'],
    ],
  },
];

function getGenrePreset(ws) {
  const id = (ws || S.currentWs)?.settings?.genrePreset;
  return id ? GENRE_PRESETS.find(g => g.id === id) || null : null;
}

// คำในชุดที่ "ยังไม่อยู่ในคลัง" และโผล่ในข้อความ — ใส่ใน prompt เป็นแนวทาง (ไม่ใช่คำบังคับเท่าคลังศัพท์)
function genreTermHints(g, text, glossary, max = 40) {
  const have = new Set((glossary || []).map(e => _normGenreKey(e.korean)));
  const src = String(text || '').toLowerCase();
  return g.terms.filter(([s]) => !have.has(_normGenreKey(s)) && (!text || src.includes(s.toLowerCase()))).slice(0, max).map(([s, t]) => `${s} = ${t}`);
}
function _normGenreKey(s) { return String(s || '').normalize('NFC').trim().toLowerCase(); }

// บล็อกแนวทางตามแนว — ใช้ในการแปล (เฉพาะคำที่โผล่ในต้นฉบับ) / สกัดคำ / วิเคราะห์ (ทุกคำ)
function buildGenreBlock(ws, text) {
  const g = getGenrePreset(ws);
  if (!g) return '';
  const hints = genreTermHints(g, text, (ws || S.currentWs)?.glossary);
  return `━━━━━━━━━━━━━━━━━━━━
GENRE GUIDE: ${g.name} — Thai conventions for this genre (the glossary always wins over this guide)
━━━━━━━━━━━━━━━━━━━━
${g.guide}${hints.length ? `\n• Standard Thai renderings for this genre (use them unless the glossary says otherwise):\n${hints.join(' · ')}` : ''}`;
}

// ─── Genre preset modal ───
function openGenrePreset() {
  if (!S.currentWs) { showToast('เลือก Workspace ก่อน', 'error'); return; }
  const sel = document.getElementById('gpSelect');
  const L = getSourceLang(S.currentWs);
  const cur = S.currentWs.settings?.genrePreset || '';
  const groups = { ko: 'เกาหลี', zh: 'จีน', en: 'อังกฤษ' };
  // ภาษาของเรื่องขึ้นก่อน
  const order = [L.code, ...Object.keys(groups).filter(k => k !== L.code)];
  sel.innerHTML = order.map(k => `<optgroup label="ต้นฉบับ${groups[k]}">${GENRE_PRESETS.filter(g => g.lang === k).map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('')}</optgroup>`).join('');
  sel.value = cur || GENRE_PRESETS.find(g => g.lang === L.code)?.id || GENRE_PRESETS[0].id;
  gpRender();
  openModal('modal-genre-preset');
}

function gpRender() {
  const g = GENRE_PRESETS.find(x => x.id === document.getElementById('gpSelect').value);
  if (!g) return;
  const cur = S.currentWs?.settings?.genrePreset || '';
  const L = getSourceLang(S.currentWs);
  document.getElementById('gpDesc').textContent = g.desc;
  document.getElementById('gpLangWarn').textContent = g.lang !== L.code ? `⚠ ชุดนี้สำหรับต้นฉบับ${ {ko:'เกาหลี',zh:'จีน',en:'อังกฤษ'}[g.lang] } แต่เรื่องนี้เป็นต้นฉบับ${L.th}` : '';
  document.getElementById('gpGuide').textContent = g.guide;
  document.getElementById('gpUse').checked = cur === g.id;
  document.getElementById('gpActive').textContent = cur ? `ตอนนี้ใช้: ${GENRE_PRESETS.find(x => x.id === cur)?.name || cur}` : 'ตอนนี้ยังไม่ได้ใช้แนวใด';
  const have = new Map((S.currentWs?.glossary || []).map(e => [_normGenreKey(e.korean), e.thai]));
  document.getElementById('gpTerms').innerHTML = g.terms.map(([s, t, type, , note], i) => {
    const ex = have.get(_normGenreKey(s));
    const exists = ex !== undefined;
    return `<div class="gp-term${exists ? ' gp-exists' : ''}">
      <input type="checkbox" class="gp-chk" data-i="${i}" ${exists ? 'disabled' : 'checked'} onchange="gpCount()"/>
      <span class="gp-src">${esc(s)}</span><span class="gp-arrow">→</span>
      <input class="gp-thai" id="gp-thai-${i}" value="${esc(t)}" ${exists ? 'disabled' : ''}/>
      <span class="tag tag-${type}">${esc(PRESET_TYPES?.[type] || type)}</span>
      <span class="gp-note">${exists ? `มีในคลังแล้ว: ${esc(ex || '—')}` : esc(note || '')}</span>
    </div>`;
  }).join('');
  gpCount();
}

function gpCount() {
  const n = document.querySelectorAll('.gp-chk:checked').length;
  document.getElementById('gpImportBtn').textContent = `＋ เพิ่มลงคลัง (${n})`;
}
function gpSelectAll(on) { document.querySelectorAll('.gp-chk:not(:disabled)').forEach(el => el.checked = on); gpCount(); }

async function gpSaveUse() {
  if (!S.currentWs) return;
  const id = document.getElementById('gpSelect').value;
  const use = document.getElementById('gpUse').checked;
  S.currentWs.settings = S.currentWs.settings || {};
  if (use) S.currentWs.settings.genrePreset = id;
  else if (S.currentWs.settings.genrePreset === id) delete S.currentWs.settings.genrePreset;
  await lsSaveWorkspace(S.currentWs);
  const ws = document.getElementById('wsGenrePreset');
  if (ws) ws.value = S.currentWs.settings.genrePreset || '';
  gpRender();
  showToast(use ? 'ใช้แนวทางนี้กับการแปล/สกัดคำ/AI วิเคราะห์แล้ว ✓' : 'เลิกใช้แนวทางนี้แล้ว', 'success');
}

async function gpImportSelected() {
  if (!S.currentWs) return;
  const g = GENRE_PRESETS.find(x => x.id === document.getElementById('gpSelect').value);
  const picked = [...document.querySelectorAll('.gp-chk:checked')].map(el => +el.dataset.i);
  if (!picked.length) { showToast('ยังไม่ได้เลือกคำ', 'error'); return; }
  if (!Array.isArray(S.currentWs.glossary)) S.currentWs.glossary = [];
  const have = new Set(S.currentWs.glossary.map(e => _normGenreKey(e.korean)));
  let added = 0;
  for (const i of picked) {
    const [s, t, type, gender, note] = g.terms[i];
    if (have.has(_normGenreKey(s))) continue;
    const thai = document.getElementById(`gp-thai-${i}`)?.value.trim() || t;
    const entry = sanitizeGlossaryEntry({ korean: s, thai, type, ...(gender ? { gender } : {}), note: note ? `${note} · ชุด${g.name.split('·')[1]?.trim() || g.name}` : '' });
    if (!entry) continue;
    S.currentWs.glossary.push(entry); have.add(_normGenreKey(s)); added++;
  }
  // นำเข้าชุดคำ = ตั้งใจใช้แนวนี้ → เปิดใช้แนวทางให้ด้วยถ้ายังไม่ได้เลือกแนวใด
  S.currentWs.settings = S.currentWs.settings || {};
  if (!S.currentWs.settings.genrePreset) S.currentWs.settings.genrePreset = g.id;
  S.glossaryData = S.currentWs.glossary;
  await lsSaveWorkspace(S.currentWs);
  renderGlossaryTable();
  gpRender();
  showToast(`เพิ่ม ${added} คำจากชุด "${g.name}" แล้ว ✓`, 'success');
}

// ═══════════════════════════════════════════════
// ─── AI วิเคราะห์คลังศัพท์ ───
// ═══════════════════════════════════════════════
// อันดับโมเดลต่อภาษาต้นฉบับ (ผลลัพธ์เป็นไทยเสมอ) — อิงผลประเมินที่เผยแพร่:
//  • WMT25 (human eval, ส.ค. 2025): Gemini 2.5 Pro อันดับ 1 ใน 14/16 คู่ภาษา · EN→KO: Gemini > Command A > GPT-4.1 > Claude 4 · EN→ZH: Gemini > GPT-4.1
//  • Alconost (ข้อมูลถึง เม.ย. 2026): เกาหลี Gemini 78.2 / DeepSeek 70.7 · ไทย Gemini 75.0 / Anthropic 68.2 · จีนตัวย่อ DeepSeek 72.2 / Gemini 71.9
//  ผลประเมินทำกับรุ่นก่อนหน้า → จัดอันดับตาม "ตระกูลโมเดล" แล้วใช้รุ่นปัจจุบันบน OpenRouter
const ANALYZE_MODEL_RANKS = {
  ko: [
    ['google/gemini-3.1-pro-preview', 'Gemini 3.1 Pro', 'ตระกูล Gemini ได้อันดับ 1 ทั้งเกาหลี (Alconost 78.2) และไทย (75.0) · WMT25 ที่ 1 ฝั่งเกาหลี'],
    ['google/gemini-3.8-flash', 'Gemini 3.8 Flash', 'ตระกูลเดียวกับอันดับ 1 แต่ถูกกว่าราว 3 เท่า — คุ้มสุดสำหรับคลังใหญ่'],
    ['anthropic/claude-sonnet-5.5', 'Claude Sonnet 5.5', 'Anthropic ได้อันดับ 2 ด้านภาษาไทย (68.2) · อธิบายเหตุผลละเอียด'],
    ['deepseek/deepseek-v4-pro', 'DeepSeek V4 Pro', 'DeepSeek อันดับ 2 ด้านเกาหลี (70.7) · ราคาถูกมาก'],
    ['openai/gpt-5.6-sol', 'GPT-5.6 Sol', 'GPT อยู่กลุ่มบนของ WMT25 ฝั่งเกาหลี (GPT-4.1 ที่ 3)'],
    ['google/gemini-3.1-flash-lite', 'Gemini 3.1 Flash Lite', 'ประหยัดสุด — ใช้ตรวจเบื้องต้น'],
  ],
  zh: [
    ['deepseek/deepseek-v4-pro', 'DeepSeek V4 Pro', 'DeepSeek อันดับ 1 จีนตัวย่อ (Alconost 72.2) · ราคาถูกมาก'],
    ['google/gemini-3.1-pro-preview', 'Gemini 3.1 Pro', 'จีนตัวย่อ 71.9 (ห่างที่ 1 นิดเดียว) + อันดับ 1 ภาษาไทย · WMT25 ที่ 1 ฝั่งจีน'],
    ['qwen/qwen3.8-max-0902', 'Qwen3.8 Max', 'โมเดลจีนโดยตรง เข้าใจสำนวน/ศัพท์เซียน-กำลังภายในดี'],
    ['google/gemini-3.8-flash', 'Gemini 3.8 Flash', 'ตระกูล Gemini ราคาประหยัด — ภาษาไทยดี'],
    ['anthropic/claude-sonnet-5.5', 'Claude Sonnet 5.5', 'จีนตัวเต็มอันดับ 2 (74.2) · ไทยอันดับ 2'],
    ['qwen/qwen3.8-flash', 'Qwen3.8 Flash', 'ประหยัดสุด — เข้าใจจีนดี แต่ภาษาไทยด้อยกว่า'],
  ],
  en: [
    ['google/gemini-3.1-pro-preview', 'Gemini 3.1 Pro', 'WMT25 ที่ 1 ใน 14/16 คู่ภาษา + อันดับ 1 ภาษาไทย'],
    ['anthropic/claude-sonnet-5.5', 'Claude Sonnet 5.5', 'อังกฤษเข้าใจลึก + ไทยอันดับ 2 (68.2)'],
    ['google/gemini-3.8-flash', 'Gemini 3.8 Flash', 'ตระกูล Gemini ราคาประหยัด — คุ้มสุดสำหรับคลังใหญ่'],
    ['openai/gpt-5.6-sol', 'GPT-5.6 Sol', 'GPT อยู่กลุ่มบนของ WMT25'],
    ['deepseek/deepseek-v4-pro', 'DeepSeek V4 Pro', 'ราคาถูกมาก คุณภาพกลางบน'],
    ['openai/gpt-5.6-luna', 'GPT-5.6 Luna', 'ประหยัดสุด — ใช้ตรวจเบื้องต้น'],
  ],
};

function _modelRate(id) {
  const prov = getProvider();
  return MODEL_COSTS[prov + ':' + id] || (prov === 'openrouter' && _modelPriceMap?.[id]) || MODEL_COSTS[id] || null;
}

let _gaResults = [];   // [{ entry, issues:[{kind,problem}], options:[{thai,why}], best, type, gender }]

function openGlossaryAnalyze() {
  if (!S.currentWs) { showToast('เลือก Workspace ก่อน', 'error'); return; }
  if (!(S.glossaryData || []).length) { showToast('คลังศัพท์ว่างเปล่า', ''); return; }
  const L = getSourceLang(S.currentWs);
  const sel = document.getElementById('gaModel');
  const prov = getProvider();
  if (prov === 'openrouter') {
    const ranks = ANALYZE_MODEL_RANKS[L.code] || ANALYZE_MODEL_RANKS.ko;
    sel.innerHTML = `<optgroup label="อันดับโมเดลสำหรับ ${L.th} → ไทย">` + ranks.map(([id, name], i) => {
      const r = _modelRate(id);
      return `<option value="${id}">${i + 1}. ${esc(name)}${r ? ` · $${r.in}/$${r.out}` : ''}</option>`;
    }).join('') + `</optgroup><optgroup label="อื่น ๆ"><option value="__translate__">ใช้โมเดลแปลของเรื่อง (${esc(document.getElementById('translateModel')?.value || '')})</option></optgroup>`;
    const saved = localStorage.getItem('nt8_ga_model_' + L.code);
    sel.value = saved && [...sel.options].some(o => o.value === saved) ? saved : ranks[0][0];
  } else {
    renderModelSelect(sel, prov, document.getElementById('translateModel')?.value, false);
  }
  const g = getGenrePreset(S.currentWs);
  document.getElementById('gaGenre').textContent = g ? `แนวนิยาย: ${g.name}` : 'ยังไม่ได้เลือกแนวนิยาย (เลือกได้ที่ 📚 แนวนิยาย — ช่วยให้ตรวจแม่นขึ้น)';
  const nSel = typeof _glossarySelected !== 'undefined' ? _glossarySelected.size : 0;
  const scope = document.getElementById('gaScope');
  scope.innerHTML = `<option value="all">ทั้งคลัง (${S.glossaryData.length} คำ)</option>` +
    (nSel ? `<option value="selected">เฉพาะที่เลือกในตาราง (${nSel} คำ)</option>` : '') +
    Object.entries(PRESET_TYPES).map(([k, v]) => { const n = S.glossaryData.filter(e => (e.type || 'term') === k).length; return n ? `<option value="type:${k}">ประเภท ${esc(v)} (${n} คำ)</option>` : ''; }).join('');
  scope.value = nSel ? 'selected' : 'all';
  document.getElementById('gaResults').innerHTML = '';
  document.getElementById('gaApplyBar').style.display = 'none';
  document.getElementById('gaStatus').textContent = '';
  _gaResults = [];
  gaModelInfo();
  openModal('modal-glossary-analyze');
}

function gaGetModel() {
  const v = document.getElementById('gaModel').value;
  return v === '__translate__' ? (document.getElementById('translateModel')?.value || 'google/gemini-3.1-flash-lite') : v;
}

function gaEntries() {
  const scope = document.getElementById('gaScope').value;
  const all = S.glossaryData || [];
  if (scope === 'selected') return all.filter(e => _glossarySelected.has(e.korean));
  if (scope.startsWith('type:')) { const t = scope.slice(5); return all.filter(e => (e.type || 'term') === t); }
  return all;
}

// เหตุผล + ประมาณราคา ของโมเดลที่เลือก
function gaModelInfo() {
  const L = getSourceLang(S.currentWs);
  const id = gaGetModel();
  const rank = (ANALYZE_MODEL_RANKS[L.code] || []).find(r => r[0] === id);
  const r = _modelRate(id);
  const n = gaEntries().length;
  const wantOpts = document.getElementById('gaChkOptions').checked;
  // ประมาณ: input ~ 60 token/คำ (คำ+บริบท) + prompt + คลังอ้างอิง · output ~ 90 token/คำ ถ้าขอตัวเลือก ไม่งั้น ~30
  const batches = Math.max(1, Math.ceil(n / GA_BATCH));
  const refTok = Math.min((S.glossaryData || []).length, 400) * 12;
  const inTok = n * 60 + batches * (900 + refTok);
  // + โมเดลส่วนใหญ่ "คิดก่อนตอบ" ~3,000 token/รอบ (วัดจริง: Gemini 3.8 Flash, DeepSeek V4 Pro) — คิดเงินเป็น output
  const outTok = n * (wantOpts ? 90 : 30) + batches * 3000;
  const cost = r ? (inTok / 1e6 * r.in + outTok / 1e6 * r.out) : null;
  document.getElementById('gaModelWhy').innerHTML =
    (rank ? `🏆 ${esc(rank[2])}` : 'โมเดลที่เลือกเอง') +
    `<br>📦 ${n} คำ · ${batches} รอบ` + (cost !== null ? ` · ประมาณ ${fmtUSD(cost)}` : '');
  if (getProvider() === 'openrouter' && document.getElementById('gaModel').value !== '__translate__') {
    try { localStorage.setItem('nt8_ga_model_' + L.code, document.getElementById('gaModel').value); } catch {}
  }
}

const GA_BATCH = 40;

const GLOSSARY_ANALYZE_PROMPT = `You are a senior {LANG}→Thai web-novel translation editor auditing a translator's glossary.
Every "thai" value is what gets injected into Thai translations, so it must be correct, natural Thai and consistent across the whole glossary.
{genre}
CHECKS TO RUN:
{checks}

TERMS TO AUDIT (JSON; "i" = id, "src" = {LANG} term, "ctx" = a sentence where it appears, may be empty):
{items}

REST OF THE GLOSSARY (reference only, for consistency — do not audit):
{reference}

OUTPUT: ONLY a raw JSON array, no markdown, no text before or after. {output_rule}
Each element:
{"i":<id>,"issues":[{"kind":"consistency|correctness","problem":"<short explanation in Thai>"}],"options":[{"thai":"<Thai rendering>","why":"<short reason in Thai>"}],"best":"<the single Thai you recommend>","type":"<only if the type is wrong>","gender":"<only if the gender is wrong: male|female|neutral>"}
In "problem", refer to other terms by their {LANG} text, never by id. Rules for every Thai you write: Thai script only (no {LANG} characters), one canonical spelling, natural for published Thai web novels of this genre.
If the current Thai is already the best choice, "best" must equal it exactly.`;

const GA_CHECK_TEXT = {
  consistency: `• CONSISTENCY (kind "consistency"): the same {LANG} element must be rendered the same way everywhere — compare with other terms that share a word/morpheme (e.g. a clan name alone vs inside "<name> clan"), mixed transliterate-vs-translate within the same category (some sect names translated, others transliterated), different spellings of the same transliterated name, inconsistent rank/realm ladders, and two different source terms sharing one Thai rendering when they mean different things.`,
  correctness: `• CORRECTNESS (kind "correctness"): wrong meaning or mistranslation, a transliteration where Thai readers expect a translation (or the reverse), forms of address with the wrong gender (คุณชาย is male, คุณหนู is female), a wrong "type" or character "gender" when the ctx/note shows otherwise, leftover {LANG} characters, Thai misspellings or wrong tone marks.`,
  options: `• OPTIONS: for EVERY term list 2–4 plausible Thai renderings a professional would consider (include the current Thai as one option when it is reasonable; add the meaning-based and the transliterated variants where both are viable), each with a very short reason, and pick "best".`,
};

// หา "ประโยคตัวอย่าง" ของคำจากต้นฉบับ — ช่วยให้ AI ตัดสินความหมาย/เพศได้แม่นขึ้น
function _gaContext(term, chapters) {
  if (!term) return '';
  for (const ch of chapters || []) {
    const t = ch.sourceText || '';
    const i = t.indexOf(term);
    if (i >= 0) return t.slice(Math.max(0, i - 40), i + term.length + 40).replace(/\s+/g, ' ').trim();
  }
  return '';
}

async function runGlossaryAnalyze() {
  if (!S.currentWs) return;
  const checks = ['consistency', 'correctness', 'options'].filter(k => document.getElementById('gaChk' + k[0].toUpperCase() + k.slice(1)).checked);
  if (!checks.length) { showToast('เลือกอย่างน้อย 1 การตรวจ', 'error'); return; }
  const entries = gaEntries();
  if (!entries.length) { showToast('ไม่มีคำในขอบเขตที่เลือก', 'error'); return; }
  const L = getSourceLang(S.currentWs);
  const model = gaGetModel();
  const btn = document.getElementById('gaRunBtn');
  const status = document.getElementById('gaStatus');
  btn.disabled = true;
  _gaResults = [];
  document.getElementById('gaResults').innerHTML = '';
  document.getElementById('gaApplyBar').style.display = 'none';

  // เรียงตามประเภท → คำหมวดเดียวกันอยู่ batch เดียวกัน (ตรวจความสอดคล้องในหมวดได้ดีขึ้น)
  const sorted = [...entries].sort((a, b) => (a.type || '').localeCompare(b.type || '') || String(a.korean).localeCompare(String(b.korean)));
  const g = getGenrePreset(S.currentWs);
  const genre = g ? `\nGENRE: ${g.name}. Thai conventions for this genre:\n${g.guide}\n` : '';
  const checkText = checks.map(k => GA_CHECK_TEXT[k]).join('\n').replace(/\{LANG\}/g, L.name);
  const outputRule = checks.includes('options')
    ? 'Return one element for EVERY audited term.'
    : 'Return elements ONLY for terms that have at least one issue; return [] if every term is fine.';
  const failed = [];

  try {
    for (let b = 0; b < sorted.length; b += GA_BATCH) {
      const batch = sorted.slice(b, b + GA_BATCH);
      status.textContent = `🧠 กำลังวิเคราะห์ ${Math.min(b + GA_BATCH, sorted.length)}/${sorted.length} คำ...`;
      const inBatch = new Set(batch);
      const items = batch.map((e, k) => {
        const o = { i: k, src: e.korean, thai: e.thai, type: e.type || 'term' };
        if (e.gender) o.gender = e.gender;
        if (e.note) o.note = String(e.note).slice(0, 80);
        const ctx = _gaContext(e.korean, S.currentWs.chapters);
        if (ctx) o.ctx = ctx;
        return JSON.stringify(o);
      }).join('\n');
      const reference = (S.glossaryData || []).filter(e => !inBatch.has(e)).slice(0, 400).map(e => `${e.korean} = ${e.thai}`).join('\n') || '(none)';
      const prompt = GLOSSARY_ANALYZE_PROMPT
        .replace(/\{LANG\}/g, L.name).replace('{genre}', genre).replace('{checks}', checkText)
        .replace('{output_rule}', outputRule).replace('{items}', items).replace('{reference}', reference);
      try {
        const res = await callOpenRouter({ model, messages: [{ role: 'user', content: prompt }], temperature: 0.2, max_tokens: 12000 });
        const { arr, broken } = parseJsonArrayLoose(res.choices?.[0]?.message?.content);
        if (broken || !Array.isArray(arr)) { failed.push(`รอบ ${b / GA_BATCH + 1}: อ่านคำตอบไม่ได้`); continue; }
        for (const r of arr) {
          const e = batch[Number(r?.i)];
          if (!e) continue;
          const clean = s => String(s || '').trim();
          const okThai = s => s && !/[ㄱ-ㆎ가-힣一-鿿぀-ヿ]/.test(s);
          const options = (Array.isArray(r.options) ? r.options : []).map(o => ({ thai: clean(o?.thai), why: clean(o?.why) })).filter(o => okThai(o.thai));
          let best = clean(r.best);
          if (!okThai(best)) best = '';
          if (best && !options.some(o => o.thai === best)) options.unshift({ thai: best, why: '' });
          const issues = (Array.isArray(r.issues) ? r.issues : []).filter(x => x && x.problem).map(x => ({ kind: x.kind === 'consistency' ? 'consistency' : 'correctness', problem: clean(x.problem) }));
          const type = PRESET_TYPES[r.type] && r.type !== (e.type || 'term') ? r.type : '';
          const gender = ['male', 'female', 'neutral'].includes(r.gender) && r.gender !== e.gender && (type || e.type) === 'character' ? r.gender : '';
          if (!issues.length && !options.length && !type && !gender) continue;
          _gaResults.push({ entry: e, issues, options, best, type, gender });
        }
      } catch (err) {
        failed.push(`รอบ ${b / GA_BATCH + 1}: ${err.message}`);
      }
    }
  } finally { btn.disabled = false; }

  const nIssue = _gaResults.filter(r => r.issues.length || r.type || r.gender).length;
  status.textContent = (_gaResults.length ? `✓ พบปัญหา ${nIssue} คำ · มีตัวเลือก ${_gaResults.filter(r => r.options.length).length} คำ` : (failed.length ? '❌ วิเคราะห์ไม่สำเร็จ' : '✓ ไม่พบปัญหา คลังศัพท์สอดคล้องและถูกต้องดี'))
    + (failed.length ? ` · ⚠ ล้มเหลว ${failed.length} รอบ (${failed.join(' / ')})` : '');
  gaRenderResults();
}

function gaRenderResults() {
  const box = document.getElementById('gaResults');
  if (!_gaResults.length) { box.innerHTML = ''; document.getElementById('gaApplyBar').style.display = 'none'; return; }
  const filter = document.getElementById('gaFilter').value;
  const kindLabel = { consistency: '🔗 ไม่สอดคล้อง', correctness: '⚠ ไม่ถูกต้อง' };
  // ปัญหาก่อน แล้วตามด้วยคำที่มีแค่ตัวเลือก
  const order = _gaResults.map((r, i) => i).sort((a, b) => (_gaHasIssue(_gaResults[b]) - _gaHasIssue(_gaResults[a])));
  box.innerHTML = order.map(i => {
    const r = _gaResults[i];
    const has = _gaHasIssue(r);
    if (filter === 'issues' && !has) return '';
    const cur = r.entry.thai || '';
    const change = r.best && r.best !== cur;
    const opts = [{ thai: cur, why: 'คงเดิม' }, ...r.options.filter(o => o.thai !== cur)];
    return `<div class="ga-item${has ? ' ga-has-issue' : ''}">
      <label class="ga-head"><input type="checkbox" class="ga-chk" data-i="${i}" ${has && change ? 'checked' : ''}/>
        <span class="ga-src">${esc(r.entry.korean)}</span><span class="ga-cur">${esc(cur || '—')}</span>
        ${r.issues.map(x => `<span class="ga-badge ga-${x.kind}">${kindLabel[x.kind]}</span>`).join('')}
        ${r.type ? `<span class="ga-badge ga-correctness">ประเภท → ${esc(PRESET_TYPES[r.type] || r.type)}</span>` : ''}
        ${r.gender ? `<span class="ga-badge ga-correctness">เพศ → ${{ male: 'ชาย', female: 'หญิง', neutral: 'ไม่ระบุ' }[r.gender]}</span>` : ''}
      </label>
      ${r.issues.map(x => `<div class="ga-problem">• ${esc(x.problem)}</div>`).join('')}
      <div class="ga-opts">${opts.map((o, k) => `<label class="ga-opt"><input type="radio" name="ga-opt-${i}" value="${esc(o.thai)}" ${(r.best ? o.thai === r.best : k === 0) ? 'checked' : ''} onchange="gaAutoCheck(${i})"/> <b>${esc(o.thai)}</b>${o.thai === r.best && k > 0 ? ' <span class="ga-best">แนะนำ</span>' : ''}${o.why ? ` <span class="ga-why">${esc(o.why)}</span>` : ''}</label>`).join('')}</div>
    </div>`;
  }).join('');
  document.getElementById('gaApplyBar').style.display = 'flex';
}
function _gaHasIssue(r) { return r.issues.length || r.type || r.gender ? 1 : 0; }

// เปลี่ยนตัวเลือก → ติ๊กให้อัตโนมัติ (เลือก "คงเดิม" แล้วไม่มีแก้ประเภท/เพศ → เอาติ๊กออก)
function gaAutoCheck(i) {
  const r = _gaResults[i];
  const v = document.querySelector(`input[name="ga-opt-${i}"]:checked`)?.value;
  const chk = document.querySelector(`.ga-chk[data-i="${i}"]`);
  if (chk) chk.checked = v !== (r.entry.thai || '') || !!(r.type || r.gender);
}

function gaSelectAll(on) { document.querySelectorAll('.ga-chk').forEach(el => el.checked = on); }

async function gaApplySelected() {
  if (!S.currentWs) return;
  let changed = 0;
  document.querySelectorAll('.ga-chk:checked').forEach(el => {
    const r = _gaResults[+el.dataset.i];
    if (!r) return;
    const e = r.entry;
    const v = document.querySelector(`input[name="ga-opt-${el.dataset.i}"]:checked`)?.value;
    let did = false;
    if (v && v !== e.thai) { e.thai = fixAddressGender(e.korean, v); did = true; }
    if (r.type) { e.type = r.type; did = true; }
    if (r.gender && e.type === 'character') { e.gender = r.gender; did = true; }
    if (did) changed++;
  });
  if (!changed) { showToast('ไม่มีรายการที่เปลี่ยน', ''); return; }
  S.glossaryData = S.currentWs.glossary;
  await lsSaveWorkspace(S.currentWs);
  renderGlossaryTable();
  // เอารายการที่แก้แล้วออกจากผลลัพธ์
  const done = new Set([...document.querySelectorAll('.ga-chk:checked')].map(el => +el.dataset.i));
  _gaResults = _gaResults.filter((_, i) => !done.has(i));
  gaRenderResults();
  document.getElementById('gaStatus').textContent = `✓ แก้คลังศัพท์ ${changed} คำแล้ว`;
  showToast(`แก้คลังศัพท์ ${changed} คำแล้ว ✓`, 'success');
}
