import blessed from 'blessed';
import { EventBus } from '../bus/eventbus.js';
import { ToolBus } from '../bus/toolbus.js';
import { MemoryDatabase } from '../memory/sqlite.js';

export class AgentTUI {
  private screen: blessed.Widgets.Screen;
  private logBox: any;
  private contentBox: any;
  private menuBar: any;
  private panels: Record<string, any> = {};
  
  constructor(
    private eventBus: EventBus,
    private toolBus: ToolBus,
    private db: MemoryDatabase
  ) {
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'AgentOS',
      dockBorders: true,
      fullUnicode: true,
    });

    this.screen.key(['escape', 'q', 'C-c'], () => process.exit(0));

    this.menuBar = blessed.listbar({
      parent: this.screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 1,
      keys: true,
      mouse: false,
      style: {
        bg: 'black',
        item: { fg: 'white', bg: 'black' },
        selected: { fg: 'black', bg: 'white' }
      },
      commands: {
        '1:Dashboard': { keys: ['1'], callback: () => this.switchPanel('dashboard') },
        '2:Chat': { keys: ['2'], callback: () => this.switchPanel('chat') },
        '3:Tools': { keys: ['3'], callback: () => this.switchPanel('tools') },
        '4:Cloudflare': { keys: ['4'], callback: () => this.switchPanel('cloudflare') },
      }
    } as any);

    this.contentBox = blessed.box({
      parent: this.screen,
      top: 2,
      left: 0,
      width: '100%',
      height: '100%-8',
      border: { type: 'line' },
      style: { border: { fg: 'gray' } }
    });

    this.logBox = blessed.log({
      parent: this.screen,
      bottom: 0,
      left: 0,
      width: '100%',
      height: 6,
      border: { type: 'line' },
      style: { border: { fg: 'gray' } },
      label: ' System Logs (Ctrl+L clear) ',
      tags: true,
      keys: true,
      scrollable: true,
      mouse: true
    });

    this.initPanels();
    this.setupEvents();
    this.switchPanel('dashboard');

    this.screen.key(['C-l'], () => {
      this.logBox.setContent('');
      this.screen.render();
    });

    this.screen.key(['C-p'], () => {
      this.logBox.log('Command palette requested (Not Implemented)');
    });

    this.screen.key(['tab'], () => {
      this.screen.focusNext();
    });
  }

  private initPanels() {
    this.panels.dashboard = blessed.box({
      parent: this.contentBox,
      width: '100%-2', height: '100%-2',
      content: '{bold}AgentOS Cognitive Kernel{/bold}\n\nSystem Status: Online\nPlatform: Termux / Node 22+',
      tags: true,
      hidden: true
    });

    this.panels.chat = blessed.box({
      parent: this.contentBox,
      width: '100%-2', height: '100%-2',
      content: 'Agent Loop ready.\nUse `agentos loop-test` in CLI to test.',
      hidden: true
    });

    const tools = this.toolBus.list();
    this.panels.tools = blessed.box({
      parent: this.contentBox,
      width: '100%-2', height: '100%-2',
      content: 'Available Tools (Syscalls):\n\n' + tools.map(t => `- ${t.name} [${t.riskLevel}]`).join('\n'),
      hidden: true
    });

    this.panels.cloudflare = blessed.box({
      parent: this.contentBox,
      width: '100%-2', height: '100%-2',
      content: 'Cloudflare Control Panel\nPlugin loaded successfully.',
      hidden: true
    });
  }

  private switchPanel(name: string) {
    for (const key of Object.keys(this.panels)) {
      this.panels[key].hide();
    }
    if (this.panels[name]) {
      this.panels[name].show();
      this.contentBox.setLabel(` ${name.toUpperCase()} `);
    }
    this.screen.render();
  }

  private setupEvents() {
    this.eventBus.on('*', (e) => {
      let color = 'white';
      if (e.name.includes('started') || e.name.includes('called')) color = 'cyan';
      if (e.name.includes('finished') || e.name.includes('written')) color = 'green';
      if (e.name.includes('failed') || e.name.includes('denied')) color = 'red';
      
      const payloadStr = JSON.stringify(e.payload) || '';
      const displayStr = payloadStr.length > 100 ? payloadStr.substring(0, 100) + '...' : payloadStr;
      
      this.logBox.log(`{${color}-fg}[${e.name}]{/} ${displayStr}`);
    });
  }

  start() {
    this.screen.render();
    this.logBox.log('AgentOS TUI Initialized. Use Tab or 1-4 to navigate.');
  }
}
