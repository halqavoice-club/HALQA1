export type Language = "en" | "ar" | "om" | "am" | "so"

export interface Translations {
  dashboard: string; students: string; teachers: string; guardians: string
  classes: string; attendance: string; grades: string; behavior: string
  messages: string; announcements: string; calendar: string; reports: string
  settings: string; profile: string; logout: string; notes: string
  schedule: string; fees: string; library: string; audio: string
  users: string; schools: string; audit: string; terms: string
  import: string; notifications: string; voiceClub: string
  save: string; cancel: string; delete: string; edit: string; add: string
  search: string; filter: string; export: string; import_: string
  print: string; download: string; upload: string; submit: string
  confirm: string; back: string; next: string; close: string; loading: string
  active: string; inactive: string; pending: string; suspended: string
  present: string; absent: string; late: string; excused: string
  markAttendance: string; attendanceReport: string
  totalStudents: string; attendanceRate: string
  addGrade: string; gradeReport: string; average: string; letterGrade: string
  login: string; loginTitle: string; email: string; password: string
  forgotPassword: string; resetPassword: string
  welcome: string; todayAttendance: string; recentActivity: string; upcomingEvents: string
  addStudent: string; studentId: string; enrolledClasses: string
  compose: string; send: string; reply: string; inbox: string
  language: string; theme: string; darkMode: string; lightMode: string; systemMode: string
  errorOccurred: string; tryAgain: string; noData: string
  monday: string; tuesday: string; wednesday: string; thursday: string
  friday: string; saturday: string; sunday: string
}

const en: Translations = {
  dashboard:'Dashboard', students:'Students', teachers:'Teachers', guardians:'Guardians',
  classes:'Classes', attendance:'Attendance', grades:'Grades', behavior:'Behavior',
  messages:'Messages', announcements:'Announcements', calendar:'Calendar', reports:'Reports',
  settings:'Settings', profile:'My Profile', logout:'Sign Out', notes:'Notes',
  schedule:'Schedule', fees:'Fees', library:'Library', audio:'Audio Lessons',
  users:'Users', schools:'Schools', audit:'Audit Logs', terms:'Terms',
  import:'Import / Export', notifications:'Notifications', voiceClub:'Voice Club',
  save:'Save', cancel:'Cancel', delete:'Delete', edit:'Edit', add:'Add',
  search:'Search', filter:'Filter', export:'Export', import_:'Import',
  print:'Print', download:'Download', upload:'Upload', submit:'Submit',
  confirm:'Confirm', back:'Back', next:'Next', close:'Close', loading:'Loading...',
  active:'Active', inactive:'Inactive', pending:'Pending', suspended:'Suspended',
  present:'Present', absent:'Absent', late:'Late', excused:'Excused',
  markAttendance:'Mark Attendance', attendanceReport:'Attendance Report',
  totalStudents:'Total Students', attendanceRate:'Attendance Rate',
  addGrade:'Add Grade', gradeReport:'Grade Report', average:'Average', letterGrade:'Letter Grade',
  login:'Login', loginTitle:'Sign in to your account', email:'Email Address', password:'Password',
  forgotPassword:'Forgot Password?', resetPassword:'Reset Password',
  welcome:'Welcome back', todayAttendance:"Today's Attendance",
  recentActivity:'Recent Activity', upcomingEvents:'Upcoming Events',
  addStudent:'Add Student', studentId:'Student ID', enrolledClasses:'Enrolled Classes',
  compose:'Compose', send:'Send', reply:'Reply', inbox:'Inbox',
  language:'Language', theme:'Theme', darkMode:'Dark Mode', lightMode:'Light Mode', systemMode:'System',
  errorOccurred:'An error occurred', tryAgain:'Try Again', noData:'No data found',
  monday:'Monday', tuesday:'Tuesday', wednesday:'Wednesday', thursday:'Thursday',
  friday:'Friday', saturday:'Saturday', sunday:'Sunday',
}

const ar: Translations = {
  dashboard:'لوحة التحكم', students:'الطلاب', teachers:'المعلمون', guardians:'أولياء الأمور',
  classes:'الفصول', attendance:'الحضور', grades:'الدرجات', behavior:'السلوك',
  messages:'الرسائل', announcements:'الإعلانات', calendar:'التقويم', reports:'التقارير',
  settings:'الإعدادات', profile:'ملفي الشخصي', logout:'تسجيل الخروج', notes:'الملاحظات',
  schedule:'الجدول', fees:'الرسوم', library:'المكتبة', audio:'الدروس الصوتية',
  users:'المستخدمون', schools:'المدارس', audit:'سجلات التدقيق', terms:'الفصول الدراسية',
  import:'استيراد / تصدير', notifications:'الإشعارات', voiceClub:'نادي الصوت',
  save:'حفظ', cancel:'إلغاء', delete:'حذف', edit:'تعديل', add:'إضافة',
  search:'بحث', filter:'تصفية', export:'تصدير', import_:'استيراد',
  print:'طباعة', download:'تنزيل', upload:'رفع', submit:'إرسال',
  confirm:'تأكيد', back:'رجوع', next:'التالي', close:'إغلاق', loading:'جاري التحميل...',
  active:'نشط', inactive:'غير نشط', pending:'معلق', suspended:'موقوف',
  present:'حاضر', absent:'غائب', late:'متأخر', excused:'معذور',
  markAttendance:'تسجيل الحضور', attendanceReport:'تقرير الحضور',
  totalStudents:'إجمالي الطلاب', attendanceRate:'نسبة الحضور',
  addGrade:'إضافة درجة', gradeReport:'تقرير الدرجات', average:'المعدل', letterGrade:'التقدير',
  login:'تسجيل الدخول', loginTitle:'تسجيل الدخول إلى حسابك',
  email:'البريد الإلكتروني', password:'كلمة المرور',
  forgotPassword:'نسيت كلمة المرور؟', resetPassword:'إعادة تعيين كلمة المرور',
  welcome:'مرحباً بعودتك', todayAttendance:'حضور اليوم',
  recentActivity:'النشاط الأخير', upcomingEvents:'الأحداث القادمة',
  addStudent:'إضافة طالب', studentId:'رقم الطالب', enrolledClasses:'الفصول المسجلة',
  compose:'إنشاء', send:'إرسال', reply:'رد', inbox:'صندوق الوارد',
  language:'اللغة', theme:'المظهر', darkMode:'الوضع الداكن', lightMode:'الوضع الفاتح', systemMode:'النظام',
  errorOccurred:'حدث خطأ', tryAgain:'حاول مرة أخرى', noData:'لا توجد بيانات',
  monday:'الاثنين', tuesday:'الثلاثاء', wednesday:'الأربعاء', thursday:'الخميس',
  friday:'الجمعة', saturday:'السبت', sunday:'الأحد',
}

const om: Translations = {
  dashboard:'Gabatee Bulchiinsaa', students:'Barattoota', teachers:'Barsiisota', guardians:'Maatii',
  classes:'Kutaalee', attendance:'Argama', grades:'Sadarkaa', behavior:'Amala',
  messages:'Ergaawwan', announcements:'Beeksisawwan', calendar:'Kalandara', reports:'Gabaasawwan',
  settings:"Qindaa'ina", profile:'Profaayilii Koo', logout:"Ba'i", notes:'Yaadannoo',
  schedule:'Sagantaa', fees:'Kaffaltii', library:'Maktaba', audio:'Barnoota Sagalee',
  users:'Fayyadamtoota', schools:'Mana Barumsaa', audit:'Galmee Hordoffii', terms:'Xumura',
  import:'Galchi / Baasi', notifications:'Beeksisa', voiceClub:'Kulaba Sagalee',
  save:'Kuusi', cancel:'Dhiisi', delete:'Haqi', edit:'Gulaali', add:'Dabaluu',
  search:'Barbaadi', filter:'Calaluu', export:'Baasi', import_:'Galchi',
  print:'Maxxansi', download:'Buufadhu', upload:'Ergi', submit:'Galchi',
  confirm:'Mirkaneessi', back:'Duubatti', next:'Itti Aanaa', close:'Cufii', loading:"Fe'aa jira...",
  active:'Hojjechaa jira', inactive:'Hojjechaa hin jiru', pending:'Eegaa jira', suspended:'Dhaabame',
  present:'Argama', absent:'Hin argamne', late:'Gara boodaa', excused:'Hayyamame',
  markAttendance:'Argama Galmeessi', attendanceReport:'Gabaasa Argamaa',
  totalStudents:'Barattoota Waliigalaa', attendanceRate:'Sadarkaa Argamaa',
  addGrade:'Sadarkaa Dabaluu', gradeReport:'Gabaasa Sadarkaa',
  average:'Giddu Galeessa', letterGrade:'Sadarkaa Qubee',
  login:'Seeni', loginTitle:'Herrega Kee Seeni', email:'Imeelii', password:'Jecha Darbii',
  forgotPassword:'Jecha Darbii Dagatte?', resetPassword:'Jecha Darbii Haaromsi',
  welcome:'Baga Nagaan Deebitee', todayAttendance:"Argama Har'aa",
  recentActivity:'Hojii Dhiyoo', upcomingEvents:'Taateewwan Dhufaa',
  addStudent:'Barattoo Dabaluu', studentId:'ID Barattoo', enrolledClasses:"Kutaalee Galma'ame",
  compose:'Barreessi', send:'Ergi', reply:'Deebisi', inbox:'Saanduqa Galuu',
  language:'Afaan', theme:"Mul'ata", darkMode:'Gurraacha', lightMode:'Ifaa', systemMode:'Sirna',
  errorOccurred:'Dogoggora uumame', tryAgain:"Irra deebi'i yaali", noData:'Odeeffannoo hin argamne',
  monday:'Wiixata', tuesday:'Qibxata', wednesday:'Roobii', thursday:'Kamisa',
  friday:'Jimaata', saturday:'Sanbata', sunday:'Dilbata',
}

const am: Translations = {
  dashboard:'ዳሽቦርድ', students:'ተማሪዎች', teachers:'አስተማሪዎች', guardians:'ወላጆች',
  classes:'ክፍሎች', attendance:'መገኘት', grades:'ውጤቶች', behavior:'ባህሪ',
  messages:'መልዕክቶች', announcements:'ማስታወቂያዎች', calendar:'ቀን መቁጠሪያ', reports:'ሪፖርቶች',
  settings:'ቅንብሮች', profile:'የእኔ መገለጫ', logout:'ውጣ', notes:'ማስታወሻዎች',
  schedule:'መርሃ ግብር', fees:'ክፍያዎች', library:'ቤተ መጻሕፍት', audio:'የድምፅ ትምህርቶች',
  users:'ተጠቃሚዎች', schools:'ትምህርት ቤቶች', audit:'የኦዲት ምዝገባዎች', terms:'ሴሚስተሮች',
  import:'አስገባ / አውጣ', notifications:'ማሳወቂያዎች', voiceClub:'የድምፅ ክለብ',
  save:'አስቀምጥ', cancel:'ሰርዝ', delete:'ሰርዝ', edit:'አርትዕ', add:'ጨምር',
  search:'ፈልግ', filter:'አጣራ', export:'አውጣ', import_:'አስገባ',
  print:'አትም', download:'አውርድ', upload:'ስቀል', submit:'አስገባ',
  confirm:'አረጋግጥ', back:'ተመለስ', next:'ቀጣይ', close:'ዝጋ', loading:'በመጫን ላይ...',
  active:'ንቁ', inactive:'ንቁ ያልሆነ', pending:'በመጠባበቅ ላይ', suspended:'ታግዷል',
  present:'ተገኝቷል', absent:'አልተገኘም', late:'ዘግይቷል', excused:'ፈቃድ አለው',
  markAttendance:'መገኘት ምዝገባ', attendanceReport:'የመገኘት ሪፖርት',
  totalStudents:'ጠቅላላ ተማሪዎች', attendanceRate:'የመገኘት መጠን',
  addGrade:'ውጤት ጨምር', gradeReport:'የውጤት ሪፖርት', average:'አማካይ', letterGrade:'የፊደል ደረጃ',
  login:'ግባ', loginTitle:'ወደ መለያዎ ይግቡ', email:'ኢሜይል', password:'የይለፍ ቃል',
  forgotPassword:'የይለፍ ቃል ረሳህ?', resetPassword:'የይለፍ ቃል ዳግም አስጀምር',
  welcome:'እንኳን ደህና ተመለሱ', todayAttendance:'የዛሬ መገኘት',
  recentActivity:'የቅርብ ጊዜ እንቅስቃሴ', upcomingEvents:'መጪ ዝግጅቶች',
  addStudent:'ተማሪ ጨምር', studentId:'የተማሪ መታወቂያ', enrolledClasses:'የተመዘገቡ ክፍሎች',
  compose:'ጻፍ', send:'ላክ', reply:'መልስ', inbox:'ሳጥን',
  language:'ቋንቋ', theme:'ገጽታ', darkMode:'ጨለማ ሁነታ', lightMode:'ብርሃን ሁነታ', systemMode:'ስርዓት',
  errorOccurred:'ስህተት ተፈጥሯል', tryAgain:'እንደገና ሞክር', noData:'ምንም ውሂብ አልተገኘም',
  monday:'ሰኞ', tuesday:'ማክሰኞ', wednesday:'ረቡዕ', thursday:'ሐሙስ',
  friday:'አርብ', saturday:'ቅዳሜ', sunday:'እሁድ',
}

const so: Translations = {
  dashboard:'Xafiiska', students:'Ardayda', teachers:'Macallimiinta', guardians:'Waalidka',
  classes:'Fasalada', attendance:'Xaadirnimada', grades:'Dhibcaha', behavior:'Dabeecadda',
  messages:'Fariimaha', announcements:'Xayeysiisyada', calendar:'Kalandarka', reports:'Warbixinnada',
  settings:'Dejinta', profile:'Xogta Shakhsiga', logout:'Ka Bax', notes:'Xusuus Qoraha',
  schedule:'Jadwalka', fees:'Lacagta', library:'Maktabadda', audio:'Casharka Codka',
  users:'Isticmaalayaasha', schools:'Dugsiyada', audit:'Diiwaanka Xisaabinta', terms:'Xilliyadda',
  import:'Geli / Soo Saar', notifications:'Ogeysiisyada', voiceClub:'Kooxda Codka',
  save:'Keydi', cancel:'Jooji', delete:'Tirtir', edit:'Wax ka Beddel', add:'Kudar',
  search:'Raadi', filter:'Shaandheey', export:'Soo Saar', import_:'Geli',
  print:'Daabac', download:'Soo Degso', upload:'Kor u Geli', submit:'Gudbi',
  confirm:'Xaqiiji', back:'Dib u Noqo', next:'Xiga', close:'Xidh', loading:'Waa la rarayo...',
  active:'Firfircoon', inactive:'Aan firfircoonayn', pending:'Sugaya', suspended:'La joojiyay',
  present:'Xaadir', absent:'Maqan', late:'Dib u dhacay', excused:'La cafiyay',
  markAttendance:'Xaadirnimada Diiwaan Geli', attendanceReport:'Warbixinta Xaadirnimada',
  totalStudents:'Wadarta Ardayda', attendanceRate:'Heerka Xaadirnimada',
  addGrade:'Dhibic Kudar', gradeReport:'Warbixinta Dhibcaha', average:'Celceliska', letterGrade:'Darajada Xarfaha',
  login:'Gal', loginTitle:'Akoonkaaga Gal', email:'Iimaylka', password:'Furaha Sirta',
  forgotPassword:'Ma Ilowday Furaha Sirta?', resetPassword:'Dib u Dejinta Furaha Sirta',
  welcome:'Ku Soo Dhawoow', todayAttendance:'Xaadirnimada Maanta',
  recentActivity:'Dhaqdhaqaaqa Dhowaan', upcomingEvents:'Xafladaha Soo Socda',
  addStudent:'Arday Kudar', studentId:'Aqoonsiga Ardayga', enrolledClasses:'Fasalada La Diiwaangeliyay',
  compose:'Qor', send:'Dir', reply:'Jawaab', inbox:'Sanduuqa Gelitaanka',
  language:'Luqadda', theme:'Muuqaalka', darkMode:'Qaabka Madow', lightMode:'Qaabka Iftiinka', systemMode:'Nidaamka',
  errorOccurred:'Khalad ayaa dhacay', tryAgain:'Mar kale isku day', noData:'Xog lama helin',
  monday:'Isniin', tuesday:'Talaado', wednesday:'Arbaco', thursday:'Khamiis',
  friday:'Jimce', saturday:'Sabti', sunday:'Axad',
}

export const translations: Record<Language, Translations> = { en, ar, om, am, so }

export const LANGUAGE_OPTIONS: { value: Language; label: string; nativeLabel: string; dir: 'ltr' | 'rtl' }[] = [
  { value: 'en', label: 'English',     nativeLabel: 'English',     dir: 'ltr' },
  { value: 'ar', label: 'Arabic',      nativeLabel: 'العربية',     dir: 'rtl' },
  { value: 'om', label: 'Afaan Oromo', nativeLabel: 'Afaan Oromo', dir: 'ltr' },
  { value: 'am', label: 'Amharic',     nativeLabel: 'አማርኛ',        dir: 'ltr' },
  { value: 'so', label: 'Somali',      nativeLabel: 'Soomaali',    dir: 'ltr' },
]
