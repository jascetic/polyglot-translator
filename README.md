# Polyglot Translator

Free document translator in the browser. Translate PDF, Word (.docx), text files, subtitles, screenshots and typed text between 129 languages. No account and no sign-up.

**Use it here: https://jascetic.github.io/polyglot-translator/**

## Features

- **PDF:** only the text is replaced inside the original file. Artwork, stamps, signatures, tables and page size stay as they were
- **Word (.docx):** only the words are replaced. Styles, tables, headers, images and fields stay as they were
- **Pictures, screenshots and scanned PDFs:** the words are erased and re-lettered in a matching font, color, size and angle
- **Text files:** TXT, Markdown, CSV, SRT and VTT subtitles, JSON, XML and HTML, translated line by line
- **Understands what it is given:** finds the alphabet, language and which way up a page is, and handles pages that mix languages
- **Looks inside:** translates pictures inside PDF and Word files, and filled-in PDF text fields
- **Reads natively:** right-to-left languages start from the right, and files are tagged with their new language
- **Edit wording:** correct any translated passage before downloading
- **Download** files in their original format; text downloads as .txt

## How translation works

- In **Chrome on a computer**, supported languages are translated on your own device with Chrome's built-in translator. Nothing leaves your device, and there is no daily limit.
- Everywhere else (phones, Safari, Firefox, or languages Chrome can't do on the device), text is sent to [MyMemory](https://mymemory.translated.net/), a free translation service that allows about 5,000 characters a day per connection.

Files are opened in your browser and are never uploaded. Machine translation can make mistakes, so have important legal, medical or official documents checked by a qualified translator.

## Known limits

- Replacement fonts are close matches, not the original fonts. Long translations may be set slightly smaller.
- In PDFs, alphabets outside Western European are drawn as sharp images, so that text can't be selected.
- PDF comments and other annotations, drop-down fields, and form fields whose font lacks the new alphabet are left untranslated.
- Curved, handwritten, very small or strongly blurred words in pictures may be missed.
- Translation is automatic and passage by passage: it can miss tone, context, names and idiom.
- In scans and Indic-script PDFs the old words are covered, and may still be present as hidden text.
- Password-protected files and old .doc files are not supported. At most 20 scanned pages are read per PDF.

## Run it yourself

Host the folder on any static web host, keeping `index.html` and `js/` together. There is no build step.

- `js/layout.js`: fitting translated words into the original space
- `js/pdf.js`, `js/pdf-content.js`: editing PDFs
- `js/picture.js`: reading, erasing and re-lettering pictures
- `js/docx.js`: editing Word files
- `js/workspace.js`: the file screen
