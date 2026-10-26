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
    gloss: 'Lock sects, families and factions, martial arts and technique names, realm ranks, titles and nicknames (매화검수 · 천마), named weapons and manuals, and the forms of address between disciples. Do NOT lock ordinary food, inns or clothing (만두 · 객잔 · 도포).',
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
• Skill and item names: translate the meaning when it is Korean, transliterate when it is an English loanword in the source.
• 검 is ดาบ in this genre (검술 วิชาดาบ · 검기 ปราณดาบ · 검성 จอมดาบ · 검사 นักดาบ) — กระบี่ belongs to murim / Chinese settings.`,
    gloss: 'Lock guilds, associations and hunter teams, gate and dungeon names and grades, skill, title and item names, monster names, rank words (S급 · 각성자) and System terms. Do NOT lock everyday modern words (휴대폰 · 편의점 · 지하철) or real places used plainly (서울 · 강남).',
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
    gloss: 'Lock the empire, kingdoms and territories, noble houses and their ranks, titles of recurring people (황태자 · 공녀 · 대공), temples and orders, balls and named events, and forms of address. Do NOT lock dresses, jewellery, tea or furniture unless it is a named plot object.',
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
    gloss: 'Lock sects, peaks and halls, realms and sub-stages, techniques and manuals, pills, treasures and formations, spirit beasts, secret realms and Dao names. Do NOT lock ordinary food, clothing or furniture.',
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
    gloss: 'Lock sects and gangs, martial arts and their forms, manuals, famous swords and weapons, nicknames (外号) and titles, and inns or escort agencies that recur. Do NOT lock ordinary food, wine or clothing.',
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
    gloss: 'Lock kingdoms, cities and regions, guilds and orders, classes, skills and spells, named items and monsters, noble titles of recurring people and System/LitRPG terms. Do NOT lock ordinary weapons, food and furniture (sword · bread · chair).',
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
  {
    id: 'ko-academy', lang: 'ko', name: 'เกาหลี · อะคาเดมี/โรงเรียนผู้มีพลัง (아카데미물)',
    desc: 'โรงเรียนฝึกฮันเตอร์/นักเวท/ฮีโร่ ชั้นปี การสอบ หอพัก การจัดอันดับ มักเข้าร่างตัวประกอบในนิยาย — คำเรียกในโรงเรียนต้องคงที่ทั้งเล่ม',
    guide: `• Contemporary school-life Thai: students talk casually among peers (ฉัน/นาย/เธอ; กู/มึง only for rough characters as the source shows) and politely to instructors (ครับ/ค่ะ).
• 생도 is a student of this academy → นักเรียน, never นักเรียนนายร้อย unless the school is explicitly military (사관학교). Drills, roll calls and strict instructors do not make it military.
• 교관 ครูฝึก (combat/field instructor) · 교수 อาจารย์ (lecturer) · 학장/원장 ผู้อำนวยการ — keep one choice for the whole book.
• 선배/후배 รุ่นพี่/รุ่นน้อง · 동기 เพื่อนร่วมรุ่น · 수석 ที่หนึ่งของรุ่น · 차석 ที่สองของรุ่น.
• 원작 (the original novel the narrator is trapped in) → นิยายต้นฉบับ; 엑스트라 → ตัวประกอบ; 주인공 → ตัวเอก.
• 검 is ดาบ (검술 วิชาดาบ · 검사 นักดาบ).`,
    gloss: 'Lock the academy name, its departments, classes, dormitories and clubs, ranking titles (수석 · 차석), exam and event names, instructor names, and the role words students and staff are called by (생도 · 교관 · 교수). Do NOT lock everyday school things (책상 · 교복 · 식당 · 교실).',
    terms: [
      ['아카데미', 'อะคาเดมี', 'place', '', 'academy'], ['생도', 'นักเรียน', 'title', '', 'student of the academy — นักเรียนนายร้อย เฉพาะโรงเรียนทหาร'],
      ['교관', 'ครูฝึก', 'title', '', 'instructor'], ['교수', 'อาจารย์', 'title', '', 'professor/lecturer'],
      ['학장', 'ผู้อำนวยการ', 'title', '', 'head of the academy — บางเล่มใช้ อธิการ'], ['신입생', 'นักเรียนใหม่', 'title', '', 'freshman'],
      ['선배', 'รุ่นพี่', 'honorific', '', 'senior'], ['후배', 'รุ่นน้อง', 'honorific', '', 'junior'],
      ['동기', 'เพื่อนร่วมรุ่น', 'term', '', 'same-year classmate'], ['수석', 'ที่หนึ่งของรุ่น', 'rank', '', 'top of the class'],
      ['차석', 'ที่สองของรุ่น', 'rank', '', 'second of the class'], ['학년', 'ชั้นปี', 'term', '', 'school year (1학년 ปีหนึ่ง)'],
      ['학기', 'ภาคเรียน', 'term', '', 'semester'], ['입학시험', 'การสอบเข้า', 'term', '', 'entrance exam'],
      ['입학식', 'พิธีรับนักเรียนใหม่', 'term', '', 'entrance ceremony'], ['기숙사', 'หอพัก', 'place', '', 'dormitory'],
      ['학생회', 'สภานักเรียน', 'clan', '', 'student council'], ['학생회장', 'ประธานสภานักเรียน', 'title', '', 'student council president'],
      ['특별반', 'ห้องพิเศษ', 'term', '', 'special class'], ['실습', 'การฝึกภาคปฏิบัติ', 'term', '', 'field practice'],
      ['실기', 'การสอบภาคปฏิบัติ', 'term', '', 'practical exam'], ['대련', 'การประลอง', 'term', '', 'sparring match'],
      ['결투', 'การดวล', 'term', '', 'duel'], ['랭킹', 'อันดับ', 'term', '', 'ranking'],
      ['중간고사', 'สอบกลางภาค', 'term', '', 'midterm'], ['기말고사', 'สอบปลายภาค', 'term', '', 'final exam'],
      ['퇴학', 'ไล่ออก', 'term', '', 'expulsion'], ['원작', 'นิยายต้นฉบับ', 'term', '', 'the original novel (빙의 stories)'],
      ['주인공', 'ตัวเอก', 'term', '', 'protagonist'], ['엑스트라', 'ตัวประกอบ', 'term', '', 'extra / side character'],
      ['빙의', 'การเข้าร่าง', 'term', '', 'possession / transmigration into a body'],
    ],
  },
  {
    id: 'ko-fantasy', lang: 'ko', name: 'เกาหลี · แฟนตาซีตะวันตก/ดาบและเวท (정통 판타지·이세계)',
    desc: 'อาณาจักร/จักรวรรดิแบบยุโรป ซอร์ดมาสเตอร์ ออร่า เซอร์เคิลเวท หอคอยเวท ผู้กล้า-จอมมาร หรือถูกส่งไปต่างโลก',
    guide: `• Western-fantasy Thai prose: knights and nobles speak formally, commoners plainly. No Chinese martial-arts vocabulary — 검 is ดาบ, never กระบี่; no ยุทธภพ / กำลังภายใน.
• Aura and sword ranks follow the Thai loanwords readers know: 오러 ออร่า · 소드 오러 ออร่าดาบ · 익스퍼트 เอ็กซ์เพิร์ต · 소드 마스터 ซอร์ดมาสเตอร์ · 그랜드 마스터 แกรนด์มาสเตอร์.
• Magic: 마법사 จอมเวท · 대마법사 จอมเวทสูงสุด · 서클 เซอร์เคิล (7서클 마법사 → จอมเวทเจ็ดเซอร์เคิล) · 마나 하트 หัวใจมานา · 마탑 หอคอยเวท · 마법진 วงเวท.
• Noble ranks are transliterated as in romance fantasy: 공작 ดยุก · 후작 มาร์ควิส · 백작 เคานต์ · 자작 ไวเคานต์ · 남작 บารอน.
• 이세계 ต่างโลก · 소환 อัญเชิญ · 용사 ผู้กล้า · 마왕 จอมมาร.`,
    gloss: 'Lock kingdoms and empires, noble houses, knight orders, magic towers and guilds, power ranks (익스퍼트 → 소드 마스터 → 그랜드 마스터 · each 서클 level), named swords, spells and artifacts, races and monster names. Do NOT lock generic weapons, armour or furniture (검 · 방패 · 갑옷 · 의자).',
    terms: [
      ['제국', 'จักรวรรดิ', 'place', '', 'empire'], ['왕국', 'อาณาจักร', 'place', '', 'kingdom'],
      ['기사', 'อัศวิน', 'title', '', 'knight'], ['기사단', 'คณะอัศวิน', 'clan', '', 'knight order'],
      ['견습기사', 'อัศวินฝึกหัด', 'title', '', 'squire / apprentice knight'], ['성기사', 'อัศวินศักดิ์สิทธิ์', 'title', '', 'paladin'],
      ['오러', 'ออร่า', 'term', '', 'aura'], ['소드 오러', 'ออร่าดาบ', 'skill', '', 'sword aura'],
      ['익스퍼트', 'เอ็กซ์เพิร์ต', 'rank', '', 'expert (sword rank)'], ['소드 마스터', 'ซอร์ดมาสเตอร์', 'rank', '', 'sword master'],
      ['그랜드 마스터', 'แกรนด์มาสเตอร์', 'rank', '', 'grand master'], ['검술', 'วิชาดาบ', 'skill', '', 'swordsmanship'],
      ['마법사', 'จอมเวท', 'title', '', 'mage — บางเล่มใช้ นักเวท'], ['대마법사', 'จอมเวทสูงสุด', 'title', '', 'archmage'],
      ['서클', 'เซอร์เคิล', 'rank', '', 'mana circle (7서클 = เจ็ดเซอร์เคิล)'], ['마나 하트', 'หัวใจมานา', 'term', '', 'mana heart'],
      ['마탑', 'หอคอยเวท', 'place', '', 'magic tower'], ['마탑주', 'เจ้าหอคอยเวท', 'title', '', 'master of the magic tower'],
      ['마법진', 'วงเวท', 'skill', '', 'magic circle'], ['마정석', 'ผลึกมานา', 'item', '', 'mana crystal'],
      ['정령', 'ภูตธาตุ', 'monster', '', 'elemental spirit'], ['정령사', 'ผู้ใช้ภูตธาตุ', 'title', '', 'spirit summoner'],
      ['신성력', 'พลังศักดิ์สิทธิ์', 'term', '', 'divine power'], ['교황', 'สันตะปาปา', 'title', '', 'pope'],
      ['용사', 'ผู้กล้า', 'title', '', 'hero'], ['마왕', 'จอมมาร', 'title', '', 'demon king'],
      ['마족', 'เผ่ามาร', 'monster', '', 'demon race'], ['용병', 'ทหารรับจ้าง', 'title', '', 'mercenary'],
      ['용병단', 'กองทหารรับจ้าง', 'clan', '', 'mercenary company'], ['모험가', 'นักผจญภัย', 'title', '', 'adventurer'],
      ['이세계', 'ต่างโลก', 'place', '', 'another world'], ['엘프', 'เอลฟ์', 'monster', '', 'elf'],
      ['드워프', 'ดวอร์ฟ', 'monster', '', 'dwarf'], ['드래곤', 'มังกร', 'monster', '', 'dragon'],
    ],
  },
  {
    id: 'ko-game', lang: 'ko', name: 'เกาหลี · เกม VR/เข้าร่างในเกม (게임 판타지)',
    desc: 'เกมเสมือนจริง ผู้เล่นกับ NPC เลเวลอัป คลาสลับ กิลด์วอร์ หรือติดอยู่ในเกมที่เคยเล่น',
    guide: `• Game vocabulary Thai gamers use stays as loanwords: เลเวล · สกิล · ไอเทม · บอส · เรด · ปาร์ตี้ · กิลด์ · ดรอป · บัฟ/ดีบัฟ.
• 유저/플레이어 → ผู้เล่น · 랭커 → แรงก์เกอร์ · 직업 (class) → อาชีพ · 전직 → เปลี่ยนอาชีพ · 히든 클래스 → คลาสลับ.
• System messages keep their bracket style ([ ] 『 』) and numbers exactly; translate them in a crisp, game-like tone.
• Keep in-game nicknames apart from real names: a nickname is transliterated or translated once and reused (닉네임 → ชื่อในเกม).
• In the real world the story uses modern Thai (ผม/ฉัน/นาย/เธอ).`,
    gloss: 'Lock the game title, servers, regions and dungeons, class and job names, skill and item names, guild names, player nicknames and NPC names, rarity tiers and achievement titles. Do NOT lock real-world everyday words or UI words used once (버튼 · 화면 · 컴퓨터).',
    terms: [
      ['유저', 'ผู้เล่น', 'title', '', 'user/player'], ['플레이어', 'ผู้เล่น', 'title', '', 'player'],
      ['NPC', 'เอ็นพีซี', 'title', '', 'non-player character'], ['랭커', 'แรงก์เกอร์', 'title', '', 'top-ranked player'],
      ['캡슐', 'แคปซูล', 'item', '', 'VR capsule'], ['접속', 'การเชื่อมต่อ', 'term', '', 'log on/connect — บางเล่มใช้ ล็อกอิน'],
      ['로그아웃', 'ล็อกเอาต์', 'term', '', 'log out'], ['닉네임', 'ชื่อในเกม', 'term', '', 'nickname'],
      ['직업', 'อาชีพ', 'term', '', 'class/job'], ['전직', 'เปลี่ยนอาชีพ', 'term', '', 'class change'],
      ['히든 클래스', 'คลาสลับ', 'term', '', 'hidden class'], ['레벨업', 'เลเวลอัป', 'term', '', 'level up'],
      ['경험치', 'ค่าประสบการณ์', 'term', '', 'EXP'], ['스탯', 'ค่าสถานะ', 'term', '', 'stats'],
      ['아이템', 'ไอเทม', 'item', '', 'item'], ['장비', 'อุปกรณ์สวมใส่', 'item', '', 'equipment'],
      ['인벤토리', 'ช่องเก็บของ', 'term', '', 'inventory'], ['드롭', 'ดรอป', 'term', '', 'drop'],
      ['보스', 'บอส', 'monster', '', 'boss'], ['파티', 'ปาร์ตี้', 'term', '', 'party'],
      ['길드전', 'กิลด์วอร์', 'term', '', 'guild war'], ['공성전', 'สงครามชิงปราสาท', 'term', '', 'siege war'],
      ['리스폰', 'รีสปอน', 'term', '', 'respawn'], ['운영자', 'ทีมงานเกม', 'title', '', 'game operator/GM'],
      ['튜토리얼', 'บทฝึกสอน', 'term', '', 'tutorial — บางเล่มใช้ ทิวทอเรียล'], ['업적', 'ความสำเร็จ', 'term', '', 'achievement'],
      ['칭호', 'ฉายา', 'term', '', 'title (in-game)'], ['전설 등급', 'ระดับตำนาน', 'rank', '', 'legendary grade'],
      ['유니크', 'ยูนีก', 'rank', '', 'unique grade'], ['에픽', 'เอพิก', 'rank', '', 'epic grade'],
    ],
  },
  {
    id: 'ko-apocalypse', lang: 'ko', name: 'เกาหลี · วันสิ้นโลก/หอคอย/กลุ่มดาว (멸망·탑)',
    desc: 'โลกล่มสลาย มอนสเตอร์บุก สถานการณ์เอาชีวิตรอด หอคอยให้ปีน กลุ่มดาวที่เฝ้าดูและให้การอุปถัมภ์',
    guide: `• Tense, punchy survival prose; system or scenario messages keep their bracket style and are translated crisply.
• 성좌 (the watching star beings) → กลุ่มดาว · 배후성 (a patron constellation) → ดาวผู้อุปถัมภ์ · 화신 (their chosen human) → อวตาร · 도깨비 → ทกเกบี (Korean goblin; not ก็อบลิน).
• 시나리오 → ซีนาริโอ (main/sub: ซีนาริโอหลัก/ซีนาริโอรอง) · 코인 → เหรียญ · 간접 메시지 → ข้อความทางอ้อม.
• Tower climbing: 탑 หอคอย · 층 ชั้น · 등반자 ผู้ปีนหอคอย · 시련 บททดสอบ.
• Keep one choice for every coined term for the whole book — readers track them.`,
    gloss: 'Lock the names of constellations and their modifiers/titles, scenarios, towers and floors, factions, survivor groups and shelters, skills, stigmas and coined system terms. Do NOT lock ordinary disaster words used once (불 · 연기 · 비명).',
    terms: [
      ['멸망', 'การล่มสลาย', 'term', '', 'destruction of the world'], ['종말', 'วันสิ้นโลก', 'term', '', 'the end of the world'],
      ['아포칼립스', 'อะพอคาลิปส์', 'term', '', 'apocalypse'], ['생존자', 'ผู้รอดชีวิต', 'title', '', 'survivor'],
      ['좀비', 'ซอมบี้', 'monster', '', 'zombie'], ['감염자', 'ผู้ติดเชื้อ', 'monster', '', 'infected'],
      ['쉘터', 'ที่หลบภัย', 'place', '', 'shelter'], ['시나리오', 'ซีนาริโอ', 'term', '', 'scenario — บางเล่มใช้ ฉากทัศน์'],
      ['메인 시나리오', 'ซีนาริโอหลัก', 'term', '', 'main scenario'], ['서브 시나리오', 'ซีนาริโอรอง', 'term', '', 'sub scenario'],
      ['성좌', 'กลุ่มดาว', 'title', '', 'constellation (star being)'], ['배후성', 'ดาวผู้อุปถัมภ์', 'title', '', 'sponsor constellation'],
      ['화신', 'อวตาร', 'title', '', 'incarnation (chosen of a constellation)'], ['도깨비', 'ทกเกบี', 'monster', '', 'dokkaebi'],
      ['코인', 'เหรียญ', 'item', '', 'coin'], ['간접 메시지', 'ข้อความทางอ้อม', 'term', '', 'indirect message'],
      ['성흔', 'สติกมา', 'skill', '', 'stigma — บางเล่มใช้ ตราศักดิ์สิทธิ์'], ['채널', 'แชนแนล', 'term', '', 'channel'],
      ['탑', 'หอคอย', 'place', '', 'tower'], ['층', 'ชั้น', 'term', '', 'floor'],
      ['등반자', 'ผู้ปีนหอคอย', 'title', '', 'climber'], ['시련', 'บททดสอบ', 'term', '', 'trial'],
      ['튜토리얼', 'บทฝึกสอน', 'term', '', 'tutorial'], ['회귀자', 'ผู้ย้อนเวลา', 'title', '', 'regressor'],
      ['예언자', 'ผู้หยั่งรู้', 'title', '', 'prophet / one who knows the future'], ['확률', 'ความน่าจะเป็น', 'term', '', 'probability'],
    ],
  },
  {
    id: 'ko-modern', lang: 'ko', name: 'เกาหลีปัจจุบัน · ออฟฟิศ/แชโบล/วงการบันเทิง/โรแมนซ์',
    desc: 'บริษัท ตำแหน่งงาน ตระกูลแชโบล ไอดอลและเด็กฝึก อาชีพเฉพาะทาง นิยายรักร่วมสมัย — ตำแหน่งและคำเรียกต้องคงที่',
    guide: `• Natural contemporary Thai: ผม/ฉัน/คุณ/นาย/เธอ; never ข้า/เจ้า.
• Kinship terms used as address are rendered by who speaks: 오빠/형 → พี่ (male elder), 언니/누나 → พี่ (female elder) — add the name when the source does (민준 오빠 → พี่มินจุน). Keep the nuance of 오빠 in romance with พี่ + tone, not ออปป้า, unless the glossary says so.
• Company titles keep one rendering for the whole book (see the standard renderings); -님 after a title becomes ท่าน/คุณ + title.
• In modern stories 검사 is a prosecutor → อัยการ (not a sword word); 기사님 is a driver → คนขับรถ.
• Brand names, apps and places stay as Thai readers know them.`,
    gloss: 'Lock company and group names, job titles of recurring people (회장 · 본부장 · 팀장), agencies, idol groups and their members, shows and awards, schools and hospitals, and nicknames. Do NOT lock everyday modern words (휴대폰 · 커피 · 지하철 · 회의).',
    terms: [
      ['재벌', 'แชโบล', 'term', '', 'chaebol'], ['그룹', 'กลุ่มบริษัท', 'clan', '', 'conglomerate group'],
      ['회장', 'ประธานใหญ่', 'title', '', 'chairman'], ['사장', 'ประธานบริษัท', 'title', '', 'company president'],
      ['부사장', 'รองประธานบริษัท', 'title', '', 'vice president'], ['본부장', 'ผู้อำนวยการฝ่าย', 'title', '', 'division head'],
      ['이사', 'กรรมการบริษัท', 'title', '', 'director (board)'], ['실장', 'หัวหน้าฝ่าย', 'title', '', 'office chief'],
      ['부장', 'ผู้จัดการฝ่าย', 'title', '', 'department manager'], ['과장', 'หัวหน้าแผนก', 'title', '', 'section chief'],
      ['대리', 'ผู้ช่วยผู้จัดการ', 'title', '', 'assistant manager'], ['팀장', 'หัวหน้าทีม', 'title', '', 'team leader'],
      ['사원', 'พนักงาน', 'title', '', 'staff'], ['인턴', 'เด็กฝึกงาน', 'title', '', 'intern'],
      ['비서', 'เลขา', 'title', '', 'secretary'], ['아이돌', 'ไอดอล', 'title', '', 'idol'],
      ['연습생', 'เด็กฝึก', 'title', '', 'trainee — บางเล่มใช้ เทรนนี'], ['소속사', 'ต้นสังกัด', 'clan', '', 'agency'],
      ['매니저', 'ผู้จัดการ', 'title', '', 'manager (entertainment)'], ['데뷔', 'เดบิวต์', 'term', '', 'debut'],
      ['막내', 'น้องเล็ก', 'term', '', 'maknae — บางเล่มใช้ มักเน่'], ['센터', 'เซ็นเตอร์', 'term', '', 'center position'],
      ['선배', 'รุ่นพี่', 'honorific', '', 'senior'], ['후배', 'รุ่นน้อง', 'honorific', '', 'junior'],
      ['검사', 'อัยการ', 'title', '', 'prosecutor (modern)'], ['변호사', 'ทนายความ', 'title', '', 'lawyer'],
      ['형사', 'นักสืบตำรวจ', 'title', '', 'detective'], ['레지던트', 'แพทย์ประจำบ้าน', 'title', '', 'resident doctor'],
    ],
  },
  {
    id: 'zh-palace', lang: 'zh', name: 'จีน · ราชสำนัก/วังหลัง/จวนขุนนาง (宫斗·宅斗)',
    desc: 'ฮ่องเต้ ฮองเฮา สนมชิงอำนาจ ศึกในจวน บุตรีภรรยาเอกกับบุตรีอนุ — คำเรียกตามสำนวนนิยาย/ซีรีส์จีนฉบับไทย',
    guide: `• Courtly Thai with light ราชาศัพท์ — readable, not textbook-heavy; servants speak humbly, nobles with restraint.
• Self-reference carries rank — keep one choice per character: 朕 เรา (บางเล่มทับศัพท์ เจิ้น) · 本宫 ข้า/เปิ่นกง · 本王 ข้า/เปิ่นหวาง · 臣妾 หม่อมฉัน · 臣/微臣 กระหม่อม · 奴婢 บ่าว · 奴才 บ่าว (eunuch speech may end with พ่ะย่ะค่ะ).
• Titles follow the Thai Chinese-drama convention: 皇上 ฝ่าบาท · 皇后 ฮองเฮา · 太后 ไทเฮา · 贵妃 กุ้ยเฟย · 王爷 ท่านอ๋อง · 世子 ซื่อจื่อ · 郡主 ท่านหญิง · 公公 ท่านขันที.
• Household ranks matter to the plot — 嫡 = born of the main wife, 庶 = born of a concubine: 嫡女 บุตรีภรรยาเอก · 庶女 บุตรีอนุ · 姨娘 อนุ · 夫人 ฮูหยิน.
• Personal names: Thai transliteration from Mandarin with tone marks, one spelling throughout.`,
    gloss: 'Lock every rank and title of recurring people (贵妃 · 王爷 · 郡主), palace and residence names (宫 · 殿 · 府), clans and households, official posts, and the self-reference each rank uses. Do NOT lock clothing, food or furniture (簪子 · 茶 · 屏风) unless it is a named plot object.',
    terms: [
      ['皇上', 'ฝ่าบาท', 'honorific', '', 'His Majesty (address)'], ['皇帝', 'ฮ่องเต้', 'title', '', 'emperor'],
      ['陛下', 'ฝ่าบาท', 'honorific', '', 'Your Majesty'], ['朕', 'เรา', 'honorific', '', "emperor's I — บางเล่มใช้ เจิ้น"],
      ['皇后', 'ฮองเฮา', 'title', '', 'empress'], ['太后', 'ไทเฮา', 'title', '', 'empress dowager'],
      ['贵妃', 'กุ้ยเฟย', 'title', '', 'noble consort'], ['妃', 'พระสนม', 'title', '', 'consort (เฟย)'],
      ['娘娘', 'เหนียงเหนียง', 'honorific', '', 'address to a consort — บางเล่มใช้ พระนาง'], ['本宫', 'ข้า', 'honorific', '', "consort's I — บางเล่มใช้ เปิ่นกง"],
      ['臣妾', 'หม่อมฉัน', 'honorific', 'female', 'consort speaking to the emperor'], ['太子', 'องค์รัชทายาท', 'title', 'male', 'crown prince — บางเล่มใช้ ไท่จื่อ'],
      ['太子妃', 'พระชายารัชทายาท', 'title', 'female', 'crown princess'], ['皇子', 'องค์ชาย', 'title', 'male', 'imperial prince'],
      ['公主', 'องค์หญิง', 'title', 'female', 'princess'], ['王爷', 'ท่านอ๋อง', 'title', 'male', 'prince (wang)'],
      ['王妃', 'พระชายา', 'title', 'female', "prince's consort — บางเล่มใช้ หวังเฟย"], ['世子', 'ซื่อจื่อ', 'title', 'male', 'heir of a prince/duke'],
      ['郡主', 'ท่านหญิง', 'title', 'female', 'commandery princess — บางเล่มใช้ จวิ้นจู่'], ['侯爷', 'ท่านโหว', 'title', 'male', 'marquis'],
      ['丞相', 'อัครเสนาบดี', 'title', '', 'chancellor'], ['将军', 'ท่านแม่ทัพ', 'title', '', 'general'],
      ['太监', 'ขันที', 'title', 'male', 'eunuch'], ['公公', 'ท่านขันที', 'honorific', 'male', 'address to a eunuch'],
      ['宫女', 'นางกำนัล', 'title', 'female', 'palace maid'], ['嬷嬷', 'หมัวมัว', 'title', 'female', 'senior palace matron'],
      ['后宫', 'วังหลัง', 'place', '', 'inner palace / harem'], ['冷宫', 'ตำหนักเย็น', 'place', '', 'cold palace'],
      ['圣旨', 'ราชโองการ', 'item', '', 'imperial edict'], ['王府', 'จวนอ๋อง', 'place', '', "prince's residence"],
      ['府', 'จวน', 'place', '', 'residence/manor'], ['嫡女', 'บุตรีภรรยาเอก', 'title', 'female', "main wife's daughter"],
      ['庶女', 'บุตรีอนุ', 'title', 'female', "concubine's daughter"], ['姨娘', 'อนุ', 'title', 'female', 'concubine (household) — บางเล่มใช้ อี๋เหนียง'],
      ['夫人', 'ฮูหยิน', 'honorific', 'female', 'madam / wife of rank'], ['老夫人', 'ฮูหยินผู้เฒ่า', 'honorific', 'female', 'old madam'],
      ['小姐', 'คุณหนู', 'honorific', 'female', 'young lady'], ['少爷', 'คุณชาย', 'honorific', 'male', 'young master'],
      ['丫鬟', 'สาวใช้', 'title', 'female', 'maidservant'], ['奴婢', 'บ่าว', 'honorific', '', 'servant\'s I'],
    ],
  },
  {
    id: 'zh-transmigration', lang: 'zh', name: 'จีน · ทะลุมิติ/เกิดใหม่/ระบบ (穿越·重生·快穿)',
    desc: 'ทะลุมิติเข้าร่าง เข้าไปในนิยาย เกิดใหม่ย้อนเวลาแก้แค้น ระบบมอบภารกิจข้ามโลก — ศัพท์เมตาของนิยาย (นางเอก นางร้าย ตัวประกอบ) ต้องคงที่',
    guide: `• Genre words: 穿越 ทะลุมิติ · 穿书 ทะลุมิติเข้าไปในนิยาย · 重生 เกิดใหม่ (ย้อนกลับไปในอดีต) · 快穿 ทะลุมิติข้ามโลก.
• The System (系统) speaks in a crisp, slightly playful voice; its messages keep their brackets. 宿主 → โฮสต์.
• Story-meta roles are locked terms: 女主 นางเอก · 男主 พระเอก · 女配 นางรอง · 恶毒女配 นางร้าย · 男配 พระรอง · 反派 ตัวร้าย · 炮灰 ตัวประกอบที่ถูกสังเวย · 原主 เจ้าของร่างเดิม.
• Match the register to the world the heroine lands in: an ancient world → ข้า/เจ้า and court titles (see the palace genre); a modern world → ฉัน/คุณ.
• Internet slang is rendered as natural Thai slang, not literally (白月光 รักแรกในใจ · 金手指 สูตรโกง).`,
    gloss: 'Lock the System\'s name and its terms (points, missions, rewards, punishments), world/plane names, the original novel\'s title, the meta roles (女主 · 女配 · 反派 · 炮灰), and every character\'s name in each world. Do NOT lock everyday words of the world the heroine lands in.',
    terms: [
      ['穿越', 'ทะลุมิติ', 'term', '', 'transmigration'], ['穿书', 'ทะลุมิติเข้าไปในนิยาย', 'term', '', 'transmigrating into a book'],
      ['重生', 'เกิดใหม่', 'term', '', 'rebirth (back to the past)'], ['快穿', 'ทะลุมิติข้ามโลก', 'term', '', 'quick transmigration'],
      ['系统', 'ระบบ', 'term', '', 'the System'], ['宿主', 'โฮสต์', 'title', '', 'host'],
      ['任务', 'ภารกิจ', 'term', '', 'mission'], ['积分', 'แต้มสะสม', 'term', '', 'points'],
      ['奖励', 'รางวัล', 'term', '', 'reward'], ['惩罚', 'บทลงโทษ', 'term', '', 'punishment'],
      ['位面', 'ระนาบโลก', 'place', '', 'plane — บางเล่มใช้ โลก'], ['小世界', 'โลกย่อย', 'place', '', 'small world'],
      ['气运', 'โชคชะตา', 'term', '', 'fortune/luck'], ['原主', 'เจ้าของร่างเดิม', 'title', '', 'original owner of the body'],
      ['原著', 'นิยายต้นฉบับ', 'term', '', 'the original novel'], ['剧情', 'เนื้อเรื่อง', 'term', '', 'plot'],
      ['女主', 'นางเอก', 'title', 'female', 'heroine'], ['男主', 'พระเอก', 'title', 'male', 'male lead'],
      ['女配', 'นางรอง', 'title', 'female', 'female supporting role'], ['恶毒女配', 'นางร้าย', 'title', 'female', 'villainess'],
      ['男配', 'พระรอง', 'title', 'male', 'male supporting role'], ['反派', 'ตัวร้าย', 'title', '', 'villain'],
      ['炮灰', 'ตัวประกอบที่ถูกสังเวย', 'title', '', 'cannon fodder — บางเล่มใช้ ตัวประกอบ'], ['白月光', 'รักแรกในใจ', 'term', '', 'white moonlight (unforgettable first love)'],
      ['金手指', 'สูตรโกง', 'term', '', 'golden finger (cheat ability)'], ['空间', 'มิติพกพา', 'skill', '', 'portable space'],
      ['灵泉', 'น้ำพุวิญญาณ', 'item', '', 'spirit spring'], ['前世', 'ชาติก่อน', 'term', '', 'past life'],
    ],
  },
  {
    id: 'zh-modern', lang: 'zh', name: 'จีนปัจจุบัน · เมือง/ประธานบริษัท/วงการบันเทิง (都市·总裁·娱乐圈)',
    desc: 'ประธานบริษัทเผด็จการ ตระกูลมหาเศรษฐี ดาราและวงการบันเทิง ชีวิตมหาวิทยาลัย — สำนวนร่วมสมัย',
    guide: `• Contemporary Thai: ผม/ฉัน/คุณ/นาย/เธอ — never ข้า/เจ้า or court register.
• 老公/老婆 สามี/ภรรยา (ที่รัก when used as a pet name) · 哥/姐 พี่ · 宝贝 ที่รัก.
• Company titles and entertainment terms keep one rendering (see the standard renderings).
• Weibo/online slang is rendered as natural Thai internet slang (热搜 ติดเทรนด์ · 吃瓜 ดูดราม่า · 粉丝 แฟนคลับ).
• Personal names: Thai transliteration from Mandarin; English names of Chinese characters stay in English-style Thai spelling.`,
    gloss: 'Lock company and group names, job titles of recurring people (总裁 · 总经理), families, celebrities and their stage names, agencies, shows, awards, schools and nicknames. Do NOT lock everyday modern words (手机 · 咖啡 · 地铁).',
    terms: [
      ['总裁', 'ประธาน', 'title', '', 'CEO/president — บางเล่มใช้ ท่านประธาน'], ['董事长', 'ประธานกรรมการ', 'title', '', 'chairman'],
      ['总经理', 'ผู้จัดการใหญ่', 'title', '', 'general manager'], ['经理', 'ผู้จัดการ', 'title', '', 'manager'],
      ['秘书', 'เลขา', 'title', '', 'secretary'], ['助理', 'ผู้ช่วย', 'title', '', 'assistant'],
      ['集团', 'กลุ่มบริษัท', 'clan', '', 'group/conglomerate'], ['豪门', 'ตระกูลมหาเศรษฐี', 'term', '', 'wealthy family'],
      ['少爷', 'คุณชาย', 'honorific', 'male', 'young master'], ['大小姐', 'คุณหนูใหญ่', 'honorific', 'female', 'eldest young lady'],
      ['老爷子', 'ท่านผู้เฒ่า', 'honorific', 'male', 'old master of the family'], ['娱乐圈', 'วงการบันเทิง', 'term', '', 'entertainment industry'],
      ['影帝', 'ราชาจอเงิน', 'title', 'male', 'best-actor king'], ['影后', 'ราชินีจอเงิน', 'title', 'female', 'best-actress queen'],
      ['顶流', 'ท็อปสตาร์', 'title', '', 'top-traffic star'], ['经纪人', 'ผู้จัดการส่วนตัว', 'title', '', 'agent/manager'],
      ['粉丝', 'แฟนคลับ', 'term', '', 'fans'], ['热搜', 'ติดเทรนด์', 'term', '', 'Weibo hot search'],
      ['微博', 'เวยป๋อ', 'term', '', 'Weibo'], ['综艺', 'รายการวาไรตี้', 'term', '', 'variety show'],
      ['剧组', 'กองถ่าย', 'term', '', 'film crew'], ['导演', 'ผู้กำกับ', 'title', '', 'director'],
      ['学长', 'รุ่นพี่', 'honorific', 'male', 'senior (school)'], ['学姐', 'รุ่นพี่', 'honorific', 'female', 'senior (school)'],
      ['校草', 'เดือนโรงเรียน', 'title', 'male', 'school heartthrob'], ['校花', 'ดาวโรงเรียน', 'title', 'female', 'school belle'],
    ],
  },
  {
    id: 'zh-apocalypse', lang: 'zh', name: 'จีน · วันสิ้นโลก/พลังพิเศษ (末世·异能)',
    desc: 'ซอมบี้บุก สัตว์กลายพันธุ์ ผู้มีพลังพิเศษ ฐานที่มั่น กักตุนเสบียง มักเกิดใหม่ย้อนกลับไปก่อนวันสิ้นโลก',
    guide: `• Tense, modern survival prose (ฉัน/ผม/คุณ/นาย); no court or cultivation register unless the story mixes it in.
• Power types are rendered สาย…: 雷系 สายสายฟ้า · 火系 สายไฟ · 冰系 สายน้ำแข็ง · 木系 สายพืช · 治愈系 สายรักษา · 精神系 สายจิต · 空间系 สายมิติ.
• Tiers are ranks: 一阶/二阶 → ขั้นหนึ่ง/ขั้นสอง (keep the same pattern for every tier).
• 晶核 แกนผลึก · 基地 ฐานที่มั่น · 物资 เสบียง · 尸潮 คลื่นซอมบี้ — keep them identical every time.`,
    gloss: 'Lock bases and survivor groups, power types and tiers, mutated creature names, named weapons and items, and characters\' ability names. Do NOT lock ordinary supplies (米 · 水 · 罐头) or generic places (超市 · 医院).',
    terms: [
      ['末世', 'วันสิ้นโลก', 'term', '', 'apocalypse'], ['末日', 'วันสิ้นโลก', 'term', '', 'doomsday'],
      ['丧尸', 'ซอมบี้', 'monster', '', 'zombie'], ['丧尸王', 'ราชาซอมบี้', 'monster', '', 'zombie king'],
      ['尸潮', 'คลื่นซอมบี้', 'term', '', 'zombie tide'], ['变异', 'กลายพันธุ์', 'term', '', 'mutation'],
      ['变异兽', 'สัตว์กลายพันธุ์', 'monster', '', 'mutated beast'], ['异能', 'พลังพิเศษ', 'term', '', 'supernatural ability'],
      ['异能者', 'ผู้มีพลังพิเศษ', 'title', '', 'ability user'], ['进化者', 'ผู้วิวัฒน์', 'title', '', 'evolver'],
      ['晶核', 'แกนผลึก', 'item', '', 'crystal core'], ['基地', 'ฐานที่มั่น', 'place', '', 'survivor base'],
      ['幸存者', 'ผู้รอดชีวิต', 'title', '', 'survivor'], ['物资', 'เสบียง', 'item', '', 'supplies'],
      ['囤货', 'กักตุนเสบียง', 'term', '', 'hoarding'], ['空间异能', 'พลังมิติ', 'skill', '', 'space ability'],
      ['雷系', 'สายสายฟ้า', 'term', '', 'lightning type'], ['火系', 'สายไฟ', 'term', '', 'fire type'],
      ['冰系', 'สายน้ำแข็ง', 'term', '', 'ice type'], ['木系', 'สายพืช', 'term', '', 'wood/plant type'],
      ['治愈系', 'สายรักษา', 'term', '', 'healing type'], ['精神系', 'สายจิต', 'term', '', 'mental type'],
      ['一阶', 'ขั้นหนึ่ง', 'rank', '', 'tier 1'], ['二阶', 'ขั้นสอง', 'rank', '', 'tier 2'],
    ],
  },
  {
    id: 'en-werewolf', lang: 'en', name: 'อังกฤษ · มนุษย์หมาป่า/แวมไพร์ (Werewolf·Paranormal romance)',
    desc: 'อัลฟ่า ลูน่า คู่ครอง (mate) ฝูงหมาป่า แวมไพร์ แม่มด — นิยายรักแฟนตาซีจากแพลตฟอร์มอย่าง Dreame/GoodNovel',
    guide: `• Modern romantic Thai: ฉัน/ผม/คุณ/เขา/เธอ; ข้า/เจ้า only for ancient beings or royalty as the source shows.
• Pack ranks are transliterated and capitalised in the source: Alpha อัลฟ่า · Beta เบต้า · Gamma แกมม่า · Omega โอเมก้า · Luna ลูน่า · Alpha King ราชาอัลฟ่า · Lycan ไลแคน.
• mate → คู่ครอง; "Mate!" (the wolf recognising them) → "คู่ของข้า!" spoken by the wolf; fated mate คู่แท้แห่งโชคชะตา · mate bond สายสัมพันธ์คู่ครอง · mark รอยประทับ · rejection การปฏิเสธคู่.
• mind-link การเชื่อมจิต · shift แปลงร่าง · the inner wolf has its own name and voice — keep its quotes distinct.
• Moon Goddess เทพีแห่งดวงจันทร์ · rogue โร้ก (หมาป่าไร้ฝูง).`,
    gloss: 'Lock pack names, ranks used as titles (Alpha · Luna · Beta), each character\'s wolf name, territories, covens and clans, and coined lore terms (mate bond · mark · mind-link). Do NOT lock ordinary modern words (phone · car · school).',
    terms: [
      ['Alpha', 'อัลฟ่า', 'title', '', 'pack leader'], ['Beta', 'เบต้า', 'title', '', 'second in command'],
      ['Gamma', 'แกมม่า', 'title', '', 'third in command'], ['Omega', 'โอเมก้า', 'title', '', 'lowest rank'],
      ['Luna', 'ลูน่า', 'title', 'female', "Alpha's mate / pack mother"], ['Alpha King', 'ราชาอัลฟ่า', 'title', 'male', 'king of the alphas'],
      ['Lycan', 'ไลแคน', 'monster', '', 'lycan'], ['Pack', 'ฝูง', 'clan', '', 'pack'],
      ['Pack house', 'บ้านฝูง', 'place', '', 'pack house'], ['Mate', 'คู่ครอง', 'term', '', 'mate'],
      ['Fated mate', 'คู่แท้แห่งโชคชะตา', 'term', '', 'fated mate — บางเล่มใช้ คู่แท้'], ['Second chance mate', 'คู่ครองโอกาสที่สอง', 'term', '', 'second chance mate'],
      ['Mate bond', 'สายสัมพันธ์คู่ครอง', 'term', '', 'mate bond'], ['Mark', 'รอยประทับ', 'term', '', 'mating mark'],
      ['Rejection', 'การปฏิเสธคู่', 'term', '', 'mate rejection'], ['Rogue', 'โร้ก', 'monster', '', 'packless wolf — หมาป่าไร้ฝูง'],
      ['Mind-link', 'การเชื่อมจิต', 'skill', '', 'mind-link'], ['Shift', 'การแปลงร่าง', 'skill', '', 'shifting'],
      ['Moon Goddess', 'เทพีแห่งดวงจันทร์', 'title', 'female', 'moon goddess'], ['Full moon', 'จันทร์เต็มดวง', 'term', '', 'full moon'],
      ['Wolfsbane', 'วูล์ฟสเบน', 'item', '', 'wolfsbane'], ['Vampire', 'แวมไพร์', 'monster', '', 'vampire'],
      ['Witch', 'แม่มด', 'title', 'female', 'witch'], ['Coven', 'กลุ่มแม่มด', 'clan', '', 'coven'],
      ['Hybrid', 'ลูกผสม', 'term', '', 'hybrid'], ['Elder', 'ผู้อาวุโส', 'title', '', 'elder'],
    ],
  },
  {
    id: 'en-scifi', lang: 'en', name: 'อังกฤษ · ไซไฟ/อวกาศ/เมคา (Sci-fi·Space opera)',
    desc: 'ยานอวกาศ กองยาน สหพันธ์-จักรวรรดิ หุ่นรบ AI และไซบอร์ก — ยศทหารต้องตรงตามระบบ',
    guide: `• Clear, modern Thai; technical words Thai readers know stay as loanwords (เลเซอร์ · พลาสมา · วาร์ป · ไซบอร์ก · แอนดรอยด์).
• Military ranks follow Thai rank names when the source uses a navy/army system: Admiral พลเรือเอก · Commander ผู้บัญชาการ (or นาวาโท as a rank) · Lieutenant ร้อยโท · Ensign เรือตรี · Sergeant จ่า · Cadet นักเรียนนายร้อย (here the academy IS military).
• Ship names, AI names and call signs are proper names — transliterate, keep the prefix (ISS, HMS) in Latin letters.
• Units and numbers stay exact; light-years ปีแสง.`,
    gloss: 'Lock ship names and classes, fleets, factions and governments (Federation · Empire), planets and stations, military ranks of recurring people, mech and weapon models, AI names and coined tech terms. Do NOT lock generic tools and rooms (console · corridor · screen).',
    terms: [
      ['Starship', 'ยานอวกาศ', 'item', '', 'starship'], ['Fleet', 'กองยาน', 'clan', '', 'fleet'],
      ['Flagship', 'ยานธง', 'item', '', 'flagship'], ['Bridge', 'สะพานเดินเรือ', 'place', '', 'ship bridge'],
      ['Captain', 'กัปตัน', 'title', '', 'ship captain'], ['Commander', 'ผู้บัญชาการ', 'title', '', 'commander'],
      ['Admiral', 'พลเรือเอก', 'rank', '', 'admiral'], ['Lieutenant', 'ร้อยโท', 'rank', '', 'lieutenant'],
      ['Ensign', 'เรือตรี', 'rank', '', 'ensign'], ['Sergeant', 'จ่า', 'rank', '', 'sergeant'],
      ['Cadet', 'นักเรียนนายร้อย', 'title', '', 'cadet (military academy)'], ['Federation', 'สหพันธ์', 'clan', '', 'federation'],
      ['Empire', 'จักรวรรดิ', 'clan', '', 'empire'], ['Colony', 'อาณานิคม', 'place', '', 'colony'],
      ['Space station', 'สถานีอวกาศ', 'place', '', 'space station'], ['Hyperspace', 'ไฮเปอร์สเปซ', 'term', '', 'hyperspace'],
      ['Warp', 'วาร์ป', 'term', '', 'warp'], ['Jump gate', 'ประตูวาร์ป', 'place', '', 'jump gate'],
      ['Mech', 'หุ่นรบ', 'item', '', 'mech — บางเล่มใช้ เมคา'], ['Pilot', 'นักบิน', 'title', '', 'pilot'],
      ['Android', 'แอนดรอยด์', 'monster', '', 'android'], ['Cyborg', 'ไซบอร์ก', 'monster', '', 'cyborg'],
      ['Implant', 'อุปกรณ์ฝังร่าง', 'item', '', 'implant'], ['Shield', 'โล่พลังงาน', 'item', '', 'energy shield'],
      ['Credits', 'เครดิต', 'item', '', 'currency'], ['Alien', 'มนุษย์ต่างดาว', 'monster', '', 'alien'],
    ],
  },
  {
    id: 'en-cultivation', lang: 'en', name: 'อังกฤษ · บำเพ็ญเพียรแบบตะวันตก (Cultivation·Progression)',
    desc: 'นิยายบำเพ็ญเพียร/Progression ที่เขียนเป็นภาษาอังกฤษ (Royal Road ฯลฯ) — ใช้ศัพท์เซียนแบบฉบับแปลจีนไทย',
    guide: `• Treat it like a Chinese cultivation novel written in English: use the Thai จีนกำลังภายใน/เซียน vocabulary (ปราณ · ตันเถียน · ค่ายกล · โอสถ · สำนัก), ข้า/เจ้า between cultivators, ท่าน for seniors.
• Realms are ranks rendered ขั้น…: Qi Condensation ขั้นรวบรวมปราณ · Foundation Establishment ขั้นสร้างรากฐาน · Core Formation/Golden Core ขั้นแก่นทองคำ · Nascent Soul ขั้นวิญญาณก่อกำเนิด. If the author coins a new realm system, translate each tier by meaning once and keep it.
• A sword in this genre is กระบี่ when it is a cultivator's jian (Sword Intent เจตจำนงกระบี่); a Western broadsword stays ดาบ.
• English names stay English-style Thai (Lindon ลินดอน); pinyin names follow Mandarin transliteration.`,
    gloss: 'Lock every realm and sub-stage, sects and clans, techniques and manuals, pills, treasures and formations, Paths/Daos, and coined power-system words. Do NOT lock ordinary food, clothing or rooms.',
    terms: [
      ['Qi', 'ลมปราณ', 'term', '', 'qi — บางเล่มใช้ ชี่'], ['Cultivation', 'การบำเพ็ญเพียร', 'term', '', 'cultivation'],
      ['Cultivator', 'ผู้บำเพ็ญเพียร', 'title', '', 'cultivator'], ['Sect', 'สำนัก', 'clan', '', 'sect'],
      ['Elder', 'ผู้อาวุโส', 'title', '', 'elder'], ['Patriarch', 'บรรพชน', 'title', '', 'patriarch / founder'],
      ['Disciple', 'ศิษย์', 'title', '', 'disciple'], ['Inner disciple', 'ศิษย์สายใน', 'title', '', 'inner disciple'],
      ['Outer disciple', 'ศิษย์สายนอก', 'title', '', 'outer disciple'], ['Senior brother', 'ศิษย์พี่', 'honorific', 'male', 'senior brother'],
      ['Junior sister', 'ศิษย์น้องหญิง', 'honorific', 'female', 'junior sister'], ['Dantian', 'ตันเถียน', 'term', '', 'dantian'],
      ['Meridians', 'เส้นลมปราณ', 'term', '', 'meridians'], ['Qi Condensation', 'ขั้นรวบรวมปราณ', 'rank', '', 'Qi Condensation'],
      ['Foundation Establishment', 'ขั้นสร้างรากฐาน', 'rank', '', 'Foundation Establishment'], ['Golden Core', 'ขั้นแก่นทองคำ', 'rank', '', 'Golden Core'],
      ['Nascent Soul', 'ขั้นวิญญาณก่อกำเนิด', 'rank', '', 'Nascent Soul'], ['Breakthrough', 'การทะลวงขั้น', 'term', '', 'breakthrough'],
      ['Bottleneck', 'คอขวด', 'term', '', 'bottleneck'], ['Dao', 'เต๋า', 'term', '', 'dao'],
      ['Heavenly Tribulation', 'ทัณฑ์สวรรค์', 'term', '', 'tribulation'], ['Pill', 'โอสถ', 'item', '', 'pill'],
      ['Alchemist', 'นักปรุงโอสถ', 'title', '', 'alchemist'], ['Formation', 'ค่ายกล', 'skill', '', 'formation'],
      ['Spirit stone', 'ศิลาวิญญาณ', 'item', '', 'spirit stone'], ['Spiritual root', 'รากวิญญาณ', 'term', '', 'spiritual root'],
      ['Talisman', 'ยันต์', 'item', '', 'talisman'], ['Sword Intent', 'เจตจำนงกระบี่', 'skill', '', 'sword intent'],
      ['Spatial ring', 'แหวนมิติ', 'item', '', 'storage ring'], ['Manual', 'คัมภีร์', 'item', '', 'technique manual'],
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
  return g.terms.filter(([s]) => !have.has(_normGenreKey(s)) && (!text || _genreTermIn(src, s.toLowerCase()))).slice(0, max).map(([s, t]) => `${s} = ${t}`);
}
// คำอังกฤษต้องตรงทั้งคำ (Mark ไม่ใช่ market) · อักษรเกาหลี/จีนไม่มีเว้นวรรค → หาแบบ substring
function _genreTermIn(src, k) {
  if (!/^[a-z0-9][a-z0-9 '\-]*$/.test(k)) return src.includes(k);
  return new RegExp(`(^|[^a-z])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?(?![a-z])`).test(src);
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
  document.getElementById('gpGuide').textContent = g.guide + (g.gloss ? `\n\n📖 สิ่งที่ลงคลังศัพท์ในแนวนี้:\n${g.gloss}` : '');
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

// ภาษาของคลังศัพท์ = ภาษาของคำต้นฉบับในคลังจริง (ตรวจไม่ได้ → ตามตั้งค่าเรื่อง) — อันดับโมเดลและกฎใน prompt ตามภาษานี้
function gaLang(entries) {
  const t = (entries || []).map(e => e.korean).join(' ');
  const n = re => (t.match(re) || []).length;
  const ko = n(/[가-힣]/g), han = n(/[一-鿿]/g), lat = n(/[A-Za-z]/g), kana = n(/[぀-ヿ]/g);
  // คำศัพท์สั้น → เกณฑ์ต่ำกว่าการตรวจทั้งตอน (คลังใหม่ ๆ มีแค่ไม่กี่คำ)
  if (ko >= 4 && ko >= han) return SOURCE_LANGS.ko;
  if (han >= 4 && kana * 3 < han) return SOURCE_LANGS.zh;
  if (lat >= 12 && !ko && !han) return SOURCE_LANGS.en;
  return getSourceLang(S.currentWs);
}

let _gaResults = [];   // [{ entry, issues:[{kind,problem}], options:[{thai,why}], best, type, gender }]

function openGlossaryAnalyze() {
  if (!S.currentWs) { showToast('เลือก Workspace ก่อน', 'error'); return; }
  if (!(S.glossaryData || []).length) { showToast('คลังศัพท์ว่างเปล่า', ''); return; }
  const L = gaLang(S.glossaryData);
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
  const L = gaLang(gaEntries());
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
  const L = gaLang(entries);
  const model = gaGetModel();
  const btn = document.getElementById('gaRunBtn');
  const status = document.getElementById('gaStatus');
  btn.disabled = true;
  _gaResults = [];
  document.getElementById('gaResults').innerHTML = '';
  document.getElementById('gaApplyBar').style.display = 'none';

  // เรียงตามประเภท → คำหมวดเดียวกันอยู่ batch เดียวกัน (ตรวจความสอดคล้องในหมวดได้ดีขึ้น)
  const sorted = [...entries].sort((a, b) => (a.type || '').localeCompare(b.type || '') || String(a.korean).localeCompare(String(b.korean)));
  const g0 = getGenrePreset(S.currentWs);
  const g = g0 && g0.lang === L.code ? g0 : null;   // แนวของอีกภาษาไม่ใส่
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
