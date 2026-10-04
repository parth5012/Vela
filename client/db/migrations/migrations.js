// This file is required for Expo/React Native SQLite migrations - https://orm.drizzle.team/quick-sqlite/expo

import journal from './meta/_journal.json';
import m0000 from './0000_gorgeous_saracen.sql';
import m0001 from './0001_violet_sentinel.sql';
import m0002 from './0002_offline_chat_sync_metadata.sql';
import m0003 from './0003_foreground_task_execution.sql';
import m0004 from './0004_checkin_offline_queue.sql';
import m0005 from './0005_message_vectors.sql';
import m0006 from './0006_active_skill.sql';
import m0007 from './0007_agents_and_thread_agent.sql';
import m0008 from './0008_task_connection_mode.sql';

export default {
  journal,
  migrations: {
    m0000,
    m0001,
    m0002,
    m0003,
    m0004,
    m0005,
    m0006,
    m0007,
    m0008,
  },
};
  