import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Modal, Switch, ActivityIndicator, Alert, TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import db, { initializeDatabase } from '../db/client';
import { tasks, taskRuns, TaskEntity, TaskRunEntity } from '../db/schema';
import { eq, desc } from 'drizzle-orm';
import { useConfigStore } from '../store/useConfigStore';
import { AuroraScreen, Card, PrimaryButton } from '../components/ui/settingsKit';
import { useAurora } from '../hooks/useAurora';
import { calculateNextRun } from '../utils/backgroundTasks';
import { DEFAULT_PERSONAS } from '../utils/personas';

const generateId = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

export default function TasksScreen() {
  const router = useRouter();
  const { colors, sizes, aurora } = useAurora();
  const { apiUrl, apiKey } = useConfigStore();

  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'paused'>('all');
  const [taskList, setTaskList] = useState<TaskEntity[]>([]);
  const [loading, setLoading] = useState(true);

  // Form State
  const [isFormModalVisible, setIsFormModalVisible] = useState(false);
  const [editingTask, setEditingTask] = useState<TaskEntity | null>(null);
  const [formTitle, setFormTitle] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formRecurrence, setFormRecurrence] = useState<'15m' | '1h' | '12h' | '24h' | 'weekly'>('24h');
  const [formPrompt, setFormPrompt] = useState('');
  const [formAgent, setFormAgent] = useState('personal assistant');
  const [personas, setPersonas] = useState(DEFAULT_PERSONAS);

  // Detail/Run History State
  const [selectedTask, setSelectedTask] = useState<TaskEntity | null>(null);
  const [taskRunHistory, setTaskRunHistory] = useState<TaskRunEntity[]>([]);
  const [runningTaskId, setRunningTaskId] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

  useEffect(() => {
    loadTasks();
  }, []);

  useEffect(() => {
    if (apiUrl && apiKey) {
      const fetchPersonas = async () => {
        try {
          const res = await fetch(`${apiUrl}/chat/personas`, {
            headers: { Authorization: `Bearer ${apiKey}` },
          });
          if (res.ok) {
            const data = await res.json();
            const mapped = data.map((p: any) => {
              let icon = '🤖';
              if (p.id === 'teacher') icon = '👩🏫';
              else if (p.id === 'analyst') icon = '📊';
              else if (p.id === 'prompt builder') icon = '✍️';
              const fallback = DEFAULT_PERSONAS.find((d) => d.id === p.id);
              return { ...p, icon: p.icon || fallback?.icon || icon };
            });
            setPersonas(mapped);
          }
        } catch (err) {
          console.error('[fetchPersonas] Failed:', err);
        }
      };
      fetchPersonas();
    }
  }, [apiUrl, apiKey]);

  const loadTasks = async () => {
    try {
      setLoading(true);
      if (db) {
        await initializeDatabase().catch(() => {});
        const result = await db.select().from(tasks);
        setTaskList(result);
      }
    } catch (error) {
      console.error('Failed to load tasks:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadRunHistory = async (taskId: string) => {
    try {
      setLoadingHistory(true);
      if (db) {
        const runs = await db.select().from(taskRuns).where(eq(taskRuns.task_id, taskId));
        const sortedRuns = [...runs].sort((a, b) => b.started_at - a.started_at);
        setTaskRunHistory(sortedRuns);
      }
    } catch (error) {
      console.error('Failed to load run history:', error);
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleOpenForm = (task: TaskEntity | null = null) => {
    if (task) {
      setEditingTask(task);
      setFormTitle(task.title);
      setFormDescription(task.description || '');
      setFormRecurrence(task.recurrence_rule as any);
      setFormPrompt(task.task_prompt);
      setFormAgent(task.linked_agent || 'personal assistant');
    } else {
      setEditingTask(null);
      setFormTitle('');
      setFormDescription('');
      setFormRecurrence('24h');
      setFormPrompt('');
      setFormAgent('personal assistant');
    }
    setIsFormModalVisible(true);
  };

  const handleSaveTask = async () => {
    if (!formTitle.trim()) {
      Alert.alert('Validation Error', 'Title is required.');
      return;
    }
    if (!formPrompt.trim()) {
      Alert.alert('Validation Error', 'Task prompt is required.');
      return;
    }

    try {
      if (!db) return;
      await initializeDatabase().catch(() => {});

      const now = Date.now();
      if (editingTask) {
        const nextRunTime = editingTask.status === 'active' 
          ? calculateNextRun(formRecurrence, editingTask.last_run || now)
          : null;

        await db.update(tasks)
          .set({
            title: formTitle.trim(),
            description: formDescription.trim(),
            recurrence_rule: formRecurrence,
            task_prompt: formPrompt.trim(),
            linked_agent: formAgent.trim(),
            next_run: nextRunTime,
          })
          .where(eq(tasks.id, editingTask.id));
      } else {
        const newTask: TaskEntity = {
          id: generateId(),
          title: formTitle.trim(),
          description: formDescription.trim(),
          recurrence_rule: formRecurrence,
          task_prompt: formPrompt.trim(),
          linked_agent: formAgent.trim(),
          status: 'active',
          last_run: null,
          next_run: calculateNextRun(formRecurrence, now),
          created_at: now,
        };

        await db.insert(tasks).values(newTask);
      }

      setIsFormModalVisible(false);
      await loadTasks();
    } catch (error) {
      console.error('Failed to save task:', error);
      Alert.alert('Error', 'Failed to save task.');
    }
  };

  const handleDeleteTask = (taskId: string) => {
    Alert.alert('Delete Task', 'Are you sure you want to delete this task?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            if (db) {
              await db.delete(tasks).where(eq(tasks.id, taskId));
              loadTasks();
              if (selectedTask?.id === taskId) {
                setSelectedTask(null);
              }
            }
          } catch (err) {
            Alert.alert('Error', 'Failed to delete task.');
          }
        },
      },
    ]);
  };

  const handleToggleStatus = async (task: TaskEntity) => {
    try {
      if (!db) return;
      const newStatus = task.status === 'active' ? 'paused' : 'active';
      const now = Date.now();
      const nextRunTime = newStatus === 'active' 
        ? calculateNextRun(task.recurrence_rule, task.last_run || now)
        : null;

      await db.update(tasks)
        .set({
          status: newStatus,
          next_run: nextRunTime,
        })
        .where(eq(tasks.id, task.id));

      loadTasks();
    } catch (err) {
      Alert.alert('Error', 'Failed to toggle status.');
    }
  };

  const handleTriggerManualRun = async (task: TaskEntity) => {
    if (runningTaskId) return;

    const runId = generateId();
    const startedAt = Date.now();

    try {
      setRunningTaskId(task.id);

      if (!db) return;

      await db.insert(taskRuns).values({
        id: runId,
        task_id: task.id,
        status: 'running',
        started_at: startedAt,
      });

      if (selectedTask?.id === task.id) {
        loadRunHistory(task.id);
      }

      if (!apiUrl || !apiKey) {
        throw new Error('API URL or Key is not configured in Settings.');
      }

      const response = await fetch(`${apiUrl}/api/tasks/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          task_id: task.id,
          title: task.title,
          prompt: task.task_prompt,
          agent: task.linked_agent || 'personal assistant',
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP Error: ${response.status}`);
      }

      const data = await response.json();
      if (data.status === 'success') {
        await db.update(taskRuns)
          .set({
            status: 'completed',
            completed_at: Date.now(),
            output: data.output,
          })
          .where(eq(taskRuns.id, runId));
      } else {
        throw new Error(data.output || 'Unknown backend error');
      }

      const nextRunTime = calculateNextRun(task.recurrence_rule, startedAt);
      await db.update(tasks)
        .set({
          last_run: startedAt,
          next_run: nextRunTime,
        })
        .where(eq(tasks.id, task.id));

    } catch (err: any) {
      Alert.alert('Task failed', err.name === 'TypeError' ? 'Network unavailable' : (err.message || 'Execution failed'));
      if (db) {
        await db.update(taskRuns)
          .set({
            status: 'failed',
            completed_at: Date.now(),
            output: err.name === 'TypeError' ? 'Network unavailable' : (err.message || 'Execution failed'),
          })
          .where(eq(taskRuns.id, runId));
      }
    } finally {
      setRunningTaskId(null);
      loadTasks();
      if (selectedTask?.id === task.id) {
        loadRunHistory(task.id);
      }
    }
  };

  const handleOpenDetail = (task: TaskEntity) => {
    setSelectedTask(task);
    loadRunHistory(task.id);
  };

  const filteredTasks = taskList.filter((task) => {
    if (activeFilter === 'all') return true;
    return task.status === activeFilter;
  });

  const getRecurrenceLabel = (rule: string) => {
    switch (rule) {
      case '15m': return 'Every 15 minutes';
      case '1h': return 'Every hour';
      case '12h': return 'Every 12 hours';
      case '24h': return 'Daily';
      case 'weekly': return 'Weekly';
      default: return rule;
    }
  };

  return (
    <AuroraScreen title="Task Scheduler">
      {/* Filter Tabs */}
      <View style={styles.filterContainer}>
        {['all', 'active', 'paused'].map((filter) => (
          <Pressable
            key={filter}
            onPress={() => setActiveFilter(filter as any)}
            style={[
              styles.filterTab,
              activeFilter === filter && { backgroundColor: aurora.acc1, borderColor: aurora.acc1 }
            ]}
          >
            <Text
              style={[
                styles.filterTabText,
                { color: activeFilter === filter ? aurora.onAccent : colors.textMuted }
              ]}
            >
              {filter.toUpperCase()}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Main List */}
      <View style={styles.listContainer}>
        {loading ? (
          <ActivityIndicator color={aurora.acc1} style={{ marginVertical: 30 }} />
        ) : filteredTasks.length === 0 ? (
          <Text style={[styles.emptyText, { color: colors.textMuted }]}>
            No tasks found in this category.
          </Text>
        ) : (
          filteredTasks.map((task) => (
            <Card key={task.id} style={styles.taskCard}>
              <Pressable onPress={() => handleOpenDetail(task)} style={styles.cardHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.taskTitle, { color: colors.text, fontSize: sizes.title }]}>
                    {task.title}
                  </Text>
                  {task.description ? (
                    <Text style={[styles.taskDesc, { color: colors.textMuted }]} numberOfLines={2}>
                      {task.description}
                    </Text>
                  ) : null}
                </View>
                <View style={styles.statusIndicator}>
                  <Text style={[styles.badge, { 
                    backgroundColor: task.status === 'active' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                    color: task.status === 'active' ? '#10b981' : '#ef4444'
                  }]}>
                    {task.status.toUpperCase()}
                  </Text>
                </View>
              </Pressable>

              <View style={[styles.cardMeta, { borderTopColor: colors.glassBorder }]}>
                <Text style={[styles.metaText, { color: colors.textMuted }]}>
                  ⏰ {getRecurrenceLabel(task.recurrence_rule)}
                </Text>
                <Text style={[styles.metaText, { color: colors.textMuted }]}>
                  🤖 {task.linked_agent || 'personal assistant'}
                </Text>
              </View>

              <View style={styles.cardActions}>
                <View style={styles.toggleContainer}>
                  <Text style={[styles.toggleLabel, { color: colors.textMuted }]}>Active</Text>
                  <Switch
                    value={task.status === 'active'}
                    onValueChange={() => handleToggleStatus(task)}
                    thumbColor={task.status === 'active' ? aurora.acc1 : '#9f9f9f'}
                    trackColor={{ true: 'rgba(129, 140, 248, 0.3)', false: '#3f3f3f' }}
                  />
                </View>

                <View style={styles.actionsRow}>
                  <Pressable
                    onPress={() => handleTriggerManualRun(task)}
                    disabled={runningTaskId !== null}
                    style={[styles.actionBtn, { backgroundColor: 'rgba(59, 130, 246, 0.15)' }]}
                  >
                    {runningTaskId === task.id ? (
                      <ActivityIndicator size="small" color="#3b82f6" />
                    ) : (
                      <Text style={[styles.actionBtnText, { color: '#3b82f6' }]}>Run Now</Text>
                    )}
                  </Pressable>

                  <Pressable
                    onPress={() => handleOpenForm(task)}
                    style={[styles.actionBtn, { backgroundColor: 'rgba(245, 158, 11, 0.15)' }]}
                  >
                    <Text style={[styles.actionBtnText, { color: '#f59e0b' }]}>Edit</Text>
                  </Pressable>

                  <Pressable
                    onPress={() => handleDeleteTask(task.id)}
                    style={[styles.actionBtn, { backgroundColor: 'rgba(239, 68, 68, 0.15)' }]}
                  >
                    <Text style={[styles.actionBtnText, { color: '#ef4444' }]}>Delete</Text>
                  </Pressable>
                </View>
              </View>
            </Card>
          ))
        )}
      </View>

      <View style={{ marginVertical: 20 }}>
        <PrimaryButton label="+ Add Task" onPress={() => handleOpenForm(null)} />
      </View>

      {/* Add / Edit Task Modal */}
      <Modal visible={isFormModalVisible} animationType="slide" transparent>
        <LinearGradient colors={[colors.skyTop, colors.skyBottom]} style={[styles.modalScreen, { paddingVertical: 40 }]}>
          <ScrollView contentContainerStyle={styles.modalScroll}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              {editingTask ? 'Edit Task' : 'New Scheduled Task'}
            </Text>

            <View style={styles.inputGroup}>
              <Text style={[styles.inputLabel, { color: colors.textMuted }]}>Task Title</Text>
              <TextInput
                value={formTitle}
                onChangeText={setFormTitle}
                placeholder="Give your scheduled task a name"
                placeholderTextColor={colors.textDark}
                style={[styles.textInput, { color: colors.text, borderColor: colors.glassBorder, backgroundColor: 'rgba(0,0,0,0.25)' }]}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={[styles.inputLabel, { color: colors.textMuted }]}>Description (Optional)</Text>
              <TextInput
                value={formDescription}
                onChangeText={setFormDescription}
                placeholder="What does this task do?"
                placeholderTextColor={colors.textDark}
                style={[styles.textInput, { color: colors.text, borderColor: colors.glassBorder, backgroundColor: 'rgba(0,0,0,0.25)' }]}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={[styles.inputLabel, { color: colors.textMuted }]}>Recurrence Schedule</Text>
              <View style={styles.recurrencePills}>
                {['15m', '1h', '12h', '24h', 'weekly'].map((r) => (
                  <Pressable
                    key={r}
                    onPress={() => setFormRecurrence(r as any)}
                    style={[
                      styles.rPill,
                      formRecurrence === r && { backgroundColor: aurora.acc1, borderColor: aurora.acc1 }
                    ]}
                  >
                    <Text style={[styles.rPillText, { color: formRecurrence === r ? aurora.onAccent : colors.textMuted }]}>
                      {r}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={[styles.inputLabel, { color: colors.textMuted }]}>Trigger Agent</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.recurrencePills}>
                {personas.map((p) => (
                  <Pressable
                    key={p.id}
                    onPress={() => setFormAgent(p.id)}
                    style={[
                      styles.rPill,
                      formAgent === p.id && { backgroundColor: aurora.acc1, borderColor: aurora.acc1 },
                    ]}
                  >
                    <Text style={[styles.rPillText, { color: formAgent === p.id ? aurora.onAccent : colors.textMuted }]}>
                      {p.icon} {p.name}
                    </Text>
                  </Pressable>
                ))}
                {formAgent && !personas.some((p) => p.id === formAgent) ? (
                  <Pressable
                    onPress={() => setFormAgent(formAgent)}
                    style={[
                      styles.rPill,
                      { backgroundColor: aurora.acc1, borderColor: aurora.acc1 },
                    ]}
                  >
                    <Text style={[styles.rPillText, { color: aurora.onAccent }]}>
                      {formAgent} (removed)
                    </Text>
                  </Pressable>
                ) : null}
              </ScrollView>
            </View>

            <View style={styles.inputGroup}>
              <Text style={[styles.inputLabel, { color: colors.textMuted }]}>Task Instructions / Prompt</Text>
              <TextInput
                value={formPrompt}
                onChangeText={setFormPrompt}
                placeholder="Provide instructions to key agent. Runs in background."
                placeholderTextColor={colors.textDark}
                multiline
                numberOfLines={5}
                style={[styles.textArea, { color: colors.text, borderColor: colors.glassBorder, backgroundColor: 'rgba(0,0,0,0.25)' }]}
              />
            </View>

            <View style={styles.modalActions}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <PrimaryButton label="Save Task" onPress={handleSaveTask} />
              </View>
              <Pressable
                onPress={() => setIsFormModalVisible(false)}
                style={[styles.cancelBtn, { borderColor: colors.glassBorder }]}
              >
                <Text style={{ color: colors.text, fontWeight: 'bold' }}>Cancel</Text>
              </Pressable>
            </View>
          </ScrollView>
        </LinearGradient>
      </Modal>

      {/* Task Run Detail Modal */}
      <Modal visible={selectedTask !== null} animationType="slide" transparent>
        <LinearGradient colors={[colors.skyTop, colors.skyBottom]} style={[styles.modalScreen, { paddingVertical: 40 }]}>
          {selectedTask && (
            <View style={{ flex: 1, width: '100%' }}>
              <View style={styles.detailHeader}>
                <Text style={[styles.modalTitle, { color: colors.text, marginBottom: 4 }]}>
                  {selectedTask.title}
                </Text>
                <Text style={{ color: colors.textMuted, fontSize: 13, marginBottom: 12 }}>
                  {selectedTask.description || 'No description provided.'}
                </Text>
                <View style={[styles.detailMetaRow, { borderBottomColor: colors.glassBorder }]}>
                  <Text style={{ color: colors.textMuted, fontSize: 13 }}>
                    Repeat: <Text style={{ color: colors.text }}>{getRecurrenceLabel(selectedTask.recurrence_rule)}</Text>
                  </Text>
                  <Text style={{ color: colors.textMuted, fontSize: 13 }}>
                    Agent: <Text style={{ color: colors.text }}>{selectedTask.linked_agent || 'personal assistant'}</Text>
                  </Text>
                </View>
              </View>

              <Text style={[styles.historyTitle, { color: colors.text }]}>Execution Run History</Text>
              <ScrollView style={{ flex: 1, paddingHorizontal: 20 }}>
                {loadingHistory ? (
                  <ActivityIndicator color={aurora.acc1} style={{ marginVertical: 20 }} />
                ) : taskRunHistory.length === 0 ? (
                  <Text style={{ color: colors.textMuted, textAlign: 'center', marginVertical: 20 }}>
                    No execution logs found for this task.
                  </Text>
                ) : (
                  taskRunHistory.map((run) => (
                    <Card key={run.id} style={styles.runCard}>
                      <View style={styles.runCardHeader}>
                        <Text style={{ color: colors.text, fontSize: 13, fontWeight: 'bold' }}>
                          📅 {new Date(run.started_at).toLocaleString()}
                        </Text>
                        <Text style={[styles.badge, {
                          backgroundColor: run.status === 'completed' ? 'rgba(16, 185, 129, 0.15)' : run.status === 'running' ? 'rgba(59, 130, 246, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                          color: run.status === 'completed' ? '#10b981' : run.status === 'running' ? '#3b82f6' : '#ef4444'
                        }]}>
                          {run.status.toUpperCase()}
                        </Text>
                      </View>
                      {run.completed_at ? (
                        <Text style={{ color: colors.textMuted, fontSize: 11, marginBottom: 8 }}>
                          Duration: {Math.round((run.completed_at - run.started_at) / 1000)} seconds
                        </Text>
                      ) : null}
                      {run.output ? (
                        <View style={[styles.outputContainer, { backgroundColor: 'rgba(0,0,0,0.3)', borderColor: colors.glassBorder }]}>
                          <Text style={{ color: '#a5b4fc', fontSize: 11, fontWeight: 'bold', marginBottom: 4 }}>OUTPUT LOG</Text>
                          <Text style={{ color: '#e0e7ff', fontSize: 12, fontFamily: 'monospace' }}>
                            {run.output}
                          </Text>
                        </View>
                      ) : null}
                    </Card>
                  ))
                )}
              </ScrollView>

              <View style={{ paddingHorizontal: 20, paddingVertical: 10 }}>
                <PrimaryButton label="Close Details" onPress={() => setSelectedTask(null)} />
              </View>
            </View>
          )}
        </LinearGradient>
      </Modal>
    </AuroraScreen>
  );
}

const styles = StyleSheet.create({
  filterContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginVertical: 10,
  },
  filterTab: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  filterTabText: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  listContainer: {
    flex: 1,
    marginTop: 10,
    paddingHorizontal: 4,
  },
  emptyText: {
    textAlign: 'center',
    marginVertical: 40,
    fontSize: 14,
  },
  taskCard: {
    padding: 16,
    marginBottom: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingBottom: 8,
  },
  taskTitle: {
    fontWeight: 'bold',
    marginBottom: 4,
  },
  taskDesc: {
    fontSize: 13,
  },
  statusIndicator: {
    marginLeft: 8,
  },
  badge: {
    fontSize: 10,
    fontWeight: '900',
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 4,
    overflow: 'hidden',
  },
  cardMeta: {
    borderTopWidth: 1,
    paddingTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  metaText: {
    fontSize: 12,
  },
  cardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toggleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  toggleLabel: {
    fontSize: 12,
    marginRight: 6,
  },
  actionsRow: {
    flexDirection: 'row',
  },
  actionBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    marginLeft: 8,
  },
  actionBtnText: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  modalScreen: {
    flex: 1,
    alignItems: 'center',
  },
  modalScroll: {
    width: '100%',
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '900',
    textAlign: 'center',
    marginVertical: 20,
  },
  inputGroup: {
    marginBottom: 16,
    width: '100%',
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
  },
  textInput: {
    height: 44,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  recurrencePills: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  rPill: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: 'rgba(0,0,0,0.25)',
    marginHorizontal: 2,
    borderRadius: 8,
  },
  rPillText: {
    fontSize: 11,
    fontWeight: 'bold',
  },
  textArea: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    minHeight: 100,
    textAlignVertical: 'top',
  },
  modalActions: {
    flexDirection: 'row',
    marginTop: 20,
  },
  cancelBtn: {
    flex: 1,
    marginLeft: 8,
    height: 48,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailHeader: {
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  detailMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  historyTitle: {
    fontSize: 15,
    fontWeight: '800',
    paddingHorizontal: 20,
    marginTop: 15,
    marginBottom: 10,
  },
  runCard: {
    padding: 12,
    marginBottom: 12,
  },
  runCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  outputContainer: {
    padding: 8,
    borderRadius: 6,
    borderWidth: 1,
    marginTop: 4,
  },
});