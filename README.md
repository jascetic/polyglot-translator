# Polyglot Translator

Free document translator in the browser. Translate PDF, Word (.docx), text files, subtitles, screenshots and typed text between 120 languages. No account and no sign-up.

**Use it here: https://jascetic.github.io/polyglot-translator/**

## Features

- **Documents:** PDF, Word (.docx), TXT, Markdown, CSV, SRT and VTT subtitles, JSON, XML and HTML
- **Screenshots and scanned PDFs:** text is read in your browser with Tesseract.js, then translated
- **Automatic language detection**
- **Layout kept:** text is translated line by line, so headings, lists and subtitle timings stay in place
- **Download** the translation as a .txt file, or copy it in one click

## How translation works

- In **Chrome on a computer**, supported languages are translated on your own device with Chrome's built-in translator. Nothing leaves your device, and there is no daily limit.
- Everywhere else (phones, Safari, Firefox, or languages Chrome can't do on the device), text is sent to [MyMemory](https://mymemory.translated.net/), a free translation service that allows about 5,000 characters a day per connection.

Files are opened in your browser and are never uploaded. Machine translation can make mistakes, so have important legal, medical or official documents checked by a qualified translator.

## Run it yourself

The whole app is one file, `index.html`. Open it in a browser or host it on any static web host.
