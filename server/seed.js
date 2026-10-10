import { embeddedNotes, linuxNotes } from './demos/foundations.js';
import { cs7Notes } from './demos/cs7.js';

/** Demo content is created only for a new database. Existing user data is never overwritten. */
export function sampleProjects(now = Date.now()) {
  const day = 86400000;
  const wrap = (project, notes, offset) => ({
    project,
    createdAt: new Date(now - (30 - offset) * day).toISOString(),
    updatedAt: new Date(now - offset * 3600000).toISOString(),
    notes: notes.map(([title, tags, pinned, content], index) => ({
      note: { title, tags, pinned, content },
      createdAt: new Date(now - (20 - index * 0.5) * day).toISOString(),
      updatedAt: new Date(now - (index * 0.35 + offset * 0.1) * day).toISOString(),
    })),
  });
  return [
    wrap(
      { name: 'CS7GV1.0', description: 'AX615 低功耗摄像机 · 架构、媒体链路与云端协同', color: '#74B8C6' },
      cs7Notes,
      0,
    ),
    wrap(
      { name: '嵌入式开发', description: '从任务与中断，到数据流和低功耗的工程笔记', color: '#9AB893' },
      embeddedNotes,
      1,
    ),
    wrap(
      { name: 'Linux 内核', description: '进程、内存、文件系统与设备驱动的五个入口', color: '#B1A0CE' },
      linuxNotes,
      2,
    ),
  ];
}
