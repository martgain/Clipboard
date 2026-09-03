# Clipboard Shelf — Selected Features Design

**Date:** 2026-09-03  
**Scope:** User-selected feature IDs from the 100-feature catalogue: 1, 5, 10, 14, 21, 24, 25, 26, 27, 28, 30, 33, 34, 35, 36, 37, 39, 40, 42, 43, 46, 47, 49, 50, 51, 55, 81, 82, 83, 87, 88, 91, 92, 95, 97. Duplicate ID 95 is counted once.

## Goal

تحسين Clipboard Shelf فوق النسخة الحالية من غير إعادة بناء الوظائف الموجودة أو تغيير سلوك البيانات. كل اختيار يُصنّف قبل التنفيذ إلى **موجود**، **تطوير**، أو **جديد**؛ الموجود يُثبت باختبارات ولا يُعاد تنفيذه، والتطوير يحافظ على API والبيانات القديمة، والجديد يُضاف بوحدة صغيرة قابلة للاختبار.

## Implementation audit status

- The selected development features are wired through the local Markdown/storage, Electron bridge, and compact renderer paths; the existing-only IDs remain covered without duplicate controls.
- The search path includes text, OCR text, metadata, safe operators, Arabic normalization, source/date filters, deterministic ranking, and escaped highlights. A date-only upper bound includes the full selected day.
- Image analysis supports bounded local PNG palette extraction and HEX/RGB/HSL output. QR/barcode handling is a validated capability adapter and reports `unsupported` when no decoder is available locally.
- Collection nesting is validated and persisted through `parentId` with compact indentation; a dedicated drag-to-reparent control is intentionally outside this batch’s UI surface.
- OCR metadata now records detected script language, while OCR index persistence is queued and rebuilt explicitly from settings so capture stays responsive.

## Baseline discovered before implementation

- التطبيق Electron محلي على Windows، وملفات Markdown هي المصدر القابل للقراءة، مع media منفصلة وbackup snapshots.
- الالتقاط event-driven مع fallback، النص الحرفي، dedupe، pause/resume، rich metadata، وسحب النص/الصورة موجودة في source/tests.
- Ctrl/Shift selection، batch separator، generic saved lists/link groups، smart collections، bulk actions، tags، trash، quick palette، color picker، OCR hybrid/order/preprocess، tray، themes، RTL، و150-item boundary موجودة جزئيًا أو بالكامل.
- نتائج baseline الحالية: `npm.cmd test` = 225/225 passing قبل هذه الدفعة.
- شجرة العمل مقصودة الاتساخ وفيها ملفات runtime وبيانات اختبار سابقة؛ لا reset، لا checkout قسري، ولا حذف عام.

## Global constraints

- التطبيق local-only؛ لا cloud، لا telemetry، ولا إرسال clipboard/OCR إلى الإنترنت.
- النص يُحفظ حرفيًا؛ أي تنظيف أو تحويل ينتج نسخة مشتقة ولا يكتب فوق الأصل.
- الحد للعادي ثابت 150 عنصرًا؛ Pins والمجموعات لا تتأثر إلا بسياسة صريحة.
- backup/restore وmigration لا يحذفان بيانات المستخدم قبل نسخة قابلة للتحقق وhashes.
- الوسوم والملاحظات metadata وليست بديلًا عن النص الأصلي.
- الصور تحفظ كـbytes أصلية؛ QR/barcode/OCR يضيف نتائج مشتقة ويترك الصورة.
- RTL افتراضيًا، مع بقاء النصوص والروابط الإنجليزية سليمة؛ ترتيب OCR يُعرض منطقيًا لا بمجرد قلب string.
- البحث لا يغيّر ترتيب المكتبة ولا يحرر DOM كاملًا عند كل حرف.
- لا يوجد bypass لــDRM أو الأسطح المحمية؛ black/protected capture يعطي نتيجة صريحة.
- أي تغيير في bridge أو persistence يمر باختبار contract وround-trip، ثم gate كامل.

## Feature audit and decision matrix

| ID | Feature | الحالة قبل التنفيذ | القرار | معيار قبول مختصر |
|---:|---|---|---|---|
| 1 | مستمع Clipboard ذاتي الإصلاح | موجود | تثبيت فقط | listener يعمل، fallback يرجع، ولا duplicate |
| 5 | الحفاظ على النص حرفيًا | موجود | تثبيت فقط | spaces/newlines/symbols round-trip بلا trim |
| 10 | إيقاف الالتقاط مؤقتًا | موجود عبر autoCapture/pause | تثبيت فقط | pause يمنع الحفظ وresume يستأنفه |
| 14 | تحكم كامل بالكيبورد | موجود في selection/palette/accessibility | تثبيت فقط | المسارات الأساسية تعمل دون mouse |
| 21 | Drag للنص إلى أي برنامج | موجود | تثبيت فقط | النص الكامل يخرج كسحب دون حذف البطاقة |
| 24 | دمج عدة عناصر بفاصل | موجود | تثبيت فقط | split/join يحافظ على المحتوى والفاصل |
| 25 | Paste Sequence | جديد | تنفيذ | اختيار عدة عناصر يلصقها بترتيب ثابت أو ينسخها كسلسلة atomic |
| 26 | Collections/Tabs/Boards | تطوير | تنفيذ فوق link groups/smart collections | collection محفوظة query/items وعرضها compact/expanded |
| 27 | مجلدات داخل مجلدات | جديد | تنفيذ | parentId آمن، نقل/فتح/حذف يحافظ على العناصر |
| 28 | Tags وNotes | تطوير | تنفيذ notes مع الحفاظ على tags | note طويلة لا تظهر في البطاقة وتعود كاملة في inspector |
| 30 | Bulk Actions | موجود | تثبيت فقط | batch pin/tag/delete/move/undo موجود |
| 33 | Regex Search | جديد | تنفيذ | regex صالح يبحث بأمان، والخاطئ يظهر خطأ بلا crash |
| 34 | فلاتر النوع/المصدر/التاريخ | تطوير | توحيد backend/UI | filters مركبة وتعمل على text/image/source/date |
| 35 | AND/OR/NOT | جديد | تنفيذ parser محدود | query واضحة، precedence ثابت، بلا code execution |
| 36 | تطبيع البحث العربي | تطوير | تنفيذ normalize عربي اختياري | همزات/تشكيل/ألف مقصورة ومسافات تدعم البحث دون تغيير النص |
| 37 | domain/title | تطوير | استخراج metadata وفهرستها | domain/title قابلان للبحث من دون طلب شبكة |
| 39 | تظليل الكلمة | جديد | تنفيذ escaped highlights | highlight بصري لا يعرض HTML من المستخدم |
| 40 | ترتيب ذكي | جديد | تنفيذ scoring deterministic | exact/prefix/recent/type hits بترتيب قابل للاختبار |
| 42 | ترتيب عربي RTL صحيح | موجود | تثبيت فقط | fixtures متعددة السطور/RTL تمر |
| 43 | اكتشاف اللغة تلقائيًا | تطوير | تنفيذ local heuristic | ar/en/mixed/unknown مع fallback ara+eng |
| 46 | الأرقام والترقيم عربي/إنجليزي | موجود في OCR normalizer | تثبيت فقط | digits/punctuation لا تنقلب أو تضيع |
| 47 | تحسين الصورة قبل OCR | موجود | تثبيت فقط | upscale/contrast/threshold profiles تمر |
| 49 | QR وBarcode والروابط | جديد | تنفيذ local detector | payload آمن، URL/QR metadata مشتقة، فشل صريح عند unsupported |
| 50 | تحليل الألوان والصور | تطوير فوق picker | تنفيذ palette analysis | HEX/RGB/HSL + dominant/recent بدون تغيير bytes |
| 51 | تنظيف المسافات | غير موجود كتحويل مستقل | تنفيذ derived transform | preview يوضح diff ولا يمسح النص الأصلي |
| 55 | تحويل الحروف والاقتباسات والقوائم | جديد | تنفيذ deterministic transforms | uppercase/lowercase/quotes/lists locale-aware |
| 81 | Frontmatter ثابت | غير موجود | تنفيذ backward-compatible | frontmatter metadata لا يفسد marker parser القديم |
| 82 | MD لكل Collection | موجود للمجموعات الحالية | تثبيت/توسيع | كل collection file deterministic وquarantine مستقل |
| 83 | Attachments بروابط نسبية | تطوير | تنفيذ relative media refs | links داخل workspace فقط وتبقى portable |
| 87 | Version History | generations داخلية فقط | تنفيذ UI/storage facade | list/inspect/restore generation read-only ثم atomic |
| 88 | Backup Snapshots | موجود | تثبيت فقط | snapshot self-contained وmanifest/checksums/restore |
| 91 | Tray Menu | موجود | تثبيت فقط | show/hide/quick actions/cleanup عند quit |
| 92 | Themes/Density/Compact | موجود | تثبيت فقط | light/dark و210px بدون clipping |
| 95 | عربي/إنجليزي واتجاه تلقائي | موجود | تثبيت فقط | `lang/dir` وتبديل locale لا يغير data |
| 97 | فهرسة خلفية وأداء | OCR index موجود لكن persist مباشر | تطوير | queue/debounce/rebuild لا يجمد main/renderer |

## Design decisions

### Search model

`SearchQuery` يحوّل نص المستخدم إلى AST صغير: terms، quoted terms، `AND`، `OR`، `NOT`، و`/regex/` فقط. التنفيذ يطابق النص المفهرس محليًا، ويستخدم تطبيع عربي في طبقة البحث فقط، ثم يضيف score deterministic وhighlight ranges؛ لا يُسمح بتقييم JavaScript أو regex غير محدود.

### Collection model

كل collection لها `id`, `title`, `icon`, `parentId`, `kind`, `itemIds` أو `query`, `createdAt`, `updatedAt`. `parentId` لا يقبل self/descendant cycle، والـitem لا يُنسخ عند فتح المجموعة؛ board يعرض references فقط. المجموعات الحالية linkGroups/smartCollections تُهاجر بإضافة defaults، من غير تغيير معرفاتها.

### Derived transformations

التنظيف والتحويل ونتائج QR/الألوان/OCR لا تعدل entry الأصلي. كل نتيجة لها `derivedFrom`, `operation`, `createdAt` عند حفظها اختياريًا، أو تُستخدم كـclipboard output مباشرة. الإدخال إلى Markdown يظل exact، وfrontmatter يحتوي metadata غير حساسة فقط.

### Markdown and media

الـcanonical library يحتفظ بالmarkers الحالية ويضيف YAML-like frontmatter محدودًا قبلها. لا نعتمد parser YAML خارجي: parser داخلي يسمح بقائمة مفاتيح typed ومحددة، ويترك markers القديمة قابلة للقراءة. media references تستخدم `media/<sha256>.<ext>` داخل workspace أو `attachments/` داخل backup؛ لا يسمح المسار بالخروج من الجذر.

### History and background work

Transaction generations الحالية هي مصدر Version History. نضيف facade يعرض metadata فقط ويستعيد generation من خلال نفس atomic path. فهرس OCR والبحث يُحدّثان عبر queue bounded/debounced، مع flush قبل الإغلاق، ولا يُنقل plaintext إلى logs.

## Non-goals

- لا cloud sync أو حسابات أو مشاركة بين مستخدمين.
- لا OCR video كامل أو تجاوز screen-capture protection.
- لا AI/cloud transforms؛ كل التحويلات المطلوبة deterministic ومحلية.
- لا إعادة كتابة renderer إلى React ولا حذف الملفات القديمة ما دام لها consumer أو migration path.

## Verification contract

كل feature تُختبر بثلاث طبقات: pure unit، persistence/IPC contract عند الحاجة، ثم smoke renderer أو packaged path إذا غيرت runtime. قبل الـPR يجب أن يمر `npm.cmd test`، `npm.cmd audit --omit=dev --audit-level=high`، manifest/asar checks، وclean-code guard على diff. نتيجة implementation لا تعتبر مكتملة من تقرير agent وحده.

## References

- [Microsoft Advanced Paste](https://learn.microsoft.com/en-us/windows/powertoys/advanced-paste): local plain/Markdown/JSON/HTML/image transforms وOCR preview.
- [Microsoft Text Extractor](https://learn.microsoft.com/en-us/windows/powertoys/text-extractor): region OCR من الشاشة مع ملاحظة proofread واللغة.
- [CopyQ](https://github.com/hluk/CopyQ): tabs/tags/search/drag/drop/automation patterns.
- [PasteBar](https://github.com/PasteBar/PasteBarApp): collections، local storage، backup، forms/templates.
- [Electron clipboard API](https://www.electronjs.org/docs/latest/api/clipboard): formats وClipboardItem في main process.
- [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage): OS-backed encryption boundary.
