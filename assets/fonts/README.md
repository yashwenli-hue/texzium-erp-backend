# Document fonts

Fonts embedded (subset) into the PDF business documents by `src/core/documents`.
They are read from this folder at run time; nothing is downloaded at run time.

| File | Source (official Noto project, Google) | SHA-256 |
|---|---|---|
| NotoSans-Regular.ttf | https://notofonts.github.io/latin-greek-cyrillic/fonts/NotoSans/unhinted/ttf/NotoSans-Regular.ttf | ec136816fe09fa238bed437c161eafbca2177c4fd14bb5f71ef29e14ebe19c9f |
| NotoSans-Bold.ttf | https://notofonts.github.io/latin-greek-cyrillic/fonts/NotoSans/unhinted/ttf/NotoSans-Bold.ttf | cdf77f76209267bcbe08e6410d6e5a8a510a32596da322d378796bb4cb51c983 |
| NotoSansDevanagari-Regular.ttf | https://notofonts.github.io/devanagari/fonts/NotoSansDevanagari/unhinted/ttf/NotoSansDevanagari-Regular.ttf | 01f47999604b5f00c751b84fca36a4b9e5dd2838921576131ed3d38cde8c113c |
| NotoSansDevanagari-Bold.ttf | https://notofonts.github.io/devanagari/fonts/NotoSansDevanagari/unhinted/ttf/NotoSansDevanagari-Bold.ttf | 4a63e99e7498bdb431ea5f7569a3cf46c61b27f2ca31bb4b18dcfc88eb3cb1ef |

Downloaded 2026-10-12. Licence: SIL Open Font License 1.1 (OFL-NotoSans.txt from
github.com/notofonts/latin-greek-cyrillic, OFL-NotoSansDevanagari.txt from
github.com/notofonts/devanagari). The OFL allows embedding the fonts in documents
and bundling them with software; the fonts are not sold on their own and are
not renamed or modified.

Coverage: Noto Sans draws Latin (incl. Latin-1 and the typographic punctuation
’ “ ” – — …), Greek, Cyrillic and the rupee sign ₹; Noto Sans Devanagari draws
Devanagari (Hindi, Marathi, Sanskrit) and ₹ but not Latin letters. The renderer
switches font per run of text; a character neither font has is printed as "?".
Other Indian scripts (Gujarati, Tamil, Bengali, ...) need their own Noto font.
