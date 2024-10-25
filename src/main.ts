// import { MetaParser } from 'metaParser';
import { Plugin, htmlToMarkdown } from 'obsidian';
import { SheetSettingsTab } from './settings';
import { SheetElement } from './sheetElement';
import * as JSON5 from 'json5';

interface PluginSettings {
  paragraphs: boolean;
}

const DEFAULT_SETTINGS: PluginSettings = {
  paragraphs: true,
};

export class ObsidianSpreadsheet extends Plugin {
  settings: PluginSettings;

  async onload() {
    this.loadSettings();
    this.registerMarkdownPostProcessor(async (el, ctx) => {
      if (ctx.frontmatter?.['disable-sheet'] === true) {
        return;
      }

      const sec = ctx.getSectionInfo(el);
      if (!sec) {
        return;
      }

      const tableEls = el.querySelectorAll('table');
      if (tableEls.length) {
        for (const tableEl of Array.from(tableEls)) {
          if (tableEl?.id === 'obsidian-sheets-parsed') {
            return;
          }

          let source: string = '';
          const { text, lineStart, lineEnd } = sec;
          let textContent = text
            .split('\n')
            .slice(lineStart, 1 + lineEnd)
            .map(line => {
              const s = line.replace(/^.*?(?=\|(?![^[]*]))/, '');
              return s;
            });

          // skip codeblocks and raw html table
          if (textContent[0].startsWith('```') || textContent[0].startsWith('<table>')) {
            return;
          }

          const endIndex = textContent.findIndex(line => /^(?!\|)/.test(line));
          if (endIndex !== -1) {
            textContent = textContent.slice(0, endIndex + 1);
          }

          if (!textContent
            .filter((row) => /(?<!\\)\|/.test(row))
            .map((row) => row.split(/(?<!\\)\|/).map(cell => cell.trim()))
            .every((row) => !row.pop()?.trim() && !row.shift()?.trim())
          ) {
            // Need a better way to figure out if not randering a table; use test for validity on actual table function here since if get to here table is valid.
            return;
          }
          source = textContent.join('\n');

          tableEl.empty();
          ctx.addChild(new SheetElement(tableEl, source.trim(), ctx, this.app, this));
        }
        return;
      }

      const tableEl = el.closest('table');
      if (!tableEl) {
        return;
      }

      if (tableEl?.id === 'obsidian-sheets-parsed') {
        return;
      }

      const rawMarkdown = ctx.getSectionInfo(tableEl)?.text || htmlToMarkdown(tableEl);
      const rawMarkdownArray = rawMarkdown
        .replace(/\n\s*\|\s*-+.*?(?=\n)/g, '') // remove newlines and heading delim
        .replace(/^\||\|$/gm, '')
        .split(/\||\n/g);
      const toChange = rawMarkdownArray
        .reduce((cum, curr, i) => {
          /(?<!~|\\)~(?!~)|^(-+|<|\^)\s*$/.test(curr) && cum.push(i);
          return cum;
        }, [] as number[]);

      const tableHead = Array.from(tableEl.querySelectorAll('th'));
      const tableWidth = tableHead.length;
      const DOMCellArray = [...tableHead, ...Array.from(tableEl.querySelectorAll('td'))];

      for (const index of toChange) {
        const column = index % tableWidth;
        const row = Math.floor(index / tableWidth);
        const cellContent = rawMarkdownArray[index];
        if (/(?<!~|\\)~(?!~)/.test(cellContent)) {
          const cellStyles = cellContent.split(/(?<![\\~])~(?!~)/)[1];
          const classes = cellStyles.match(/(?<=\.)\S+/g)?.map(m => m.toString()) || [];

          let cellStyle = {};

          const inlineStyle = cellStyles.match(/\{.*\}/)?.[0] || '{}';
          try {
            cellStyle = { ...cellStyle, ...JSON5.parse(inlineStyle) };
          } catch {
            console.error(`Invalid cell style \`${inlineStyle}\``);
          }

          const DOMContent: HTMLTableCellElement = DOMCellArray[index].querySelector('.table-cell-wrapper') || DOMCellArray[index];
          Object.assign(DOMContent.style, cellStyle);
          DOMContent.classList.add(...classes);
          DOMContent.innerText = DOMContent.innerText.split(/(?<![\\~])~(?!~)/)[0];
        }
        // merging currently does not work - the cells get merged but the `<`/`^` cells still stay on the table
        // merge left
        else if (/^\s*<\s*$/.test(cellContent) && column > 0) {
          if (!DOMCellArray[index - 1].colSpan) DOMCellArray[index - 1].colSpan = 1;
          DOMCellArray[index - 1].colSpan += 1;
          // .remove() does not work - table editor renders on top and rebuilds the cell
          DOMCellArray[index].style.display = 'none';
          delete DOMCellArray[index];
          DOMCellArray[index] = DOMCellArray[index - 1];
        }
        // merge up
        else if (/^\s*\^\s*$/.test(cellContent) && row > 1) {
          if (!DOMCellArray[index - tableWidth].rowSpan) DOMCellArray[index - 1].rowSpan = 1;
          DOMCellArray[index - tableWidth].rowSpan += 1;
          DOMCellArray[index].style.display = 'none';
          delete DOMCellArray[index];
          DOMCellArray[index] = DOMCellArray[index - tableWidth];
        }
        // TODO: row headers
        // else if (/^\s*-+\s*$/.test(cellContent)) {
        // } 
        // classes and styling
      }

      return tableEl.id = 'obsidian-sheets-parsed';

    });

    this.addSettingTab(new SheetSettingsTab(this.app, this));
  }

  onunload() {
    // console.log('unloading spreadsheet plugin');
  }

  async loadSettings() {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      await this.loadData()
    );
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

export default ObsidianSpreadsheet;
