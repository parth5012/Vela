import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, Modal, Pressable, ScrollView, ActivityIndicator, Platform } from 'react-native';
import { useDeviceSessionStore, type SimplifiedDomNode } from '../../store/useDeviceSessionStore';
import { parseScreenHierarchy } from '../../utils/domSimplifier';
import { useAurora } from '../../hooks/useAurora';
import { Card } from '../ui/settingsKit';
import { DEFAULT_ELEVATION } from '../../utils/elevation';
import DeviceAgentNative from '../../modules/device-agent';

export function ScreenMirrorModal() {
  const visible = useDeviceSessionStore((s) => s.isMirrorVisible);
  const setVisible = useDeviceSessionStore((s) => s.setMirrorVisible);
  const hierarchy = useDeviceSessionStore((s) => s.screenMirrorHierarchy);
  const setHierarchy = useDeviceSessionStore((s) => s.setScreenMirrorHierarchy);
  const loading = useDeviceSessionStore((s) => s.isScreenMirrorLoading);
  const setLoading = useDeviceSessionStore((s) => s.setScreenMirrorLoading);
  const { colors, sizes, aurora } = useAurora();

  const [selectedNode, setSelectedNode] = useState<SimplifiedDomNode | null>(null);
  const [isSimulated, setIsSimulated] = useState(false);

  const fetchScreenTree = useCallback(async () => {
    setLoading(true);
    try {
      if (Platform.OS === 'android' && DeviceAgentNative && typeof (DeviceAgentNative as any).getScreenTree === 'function') {
        const raw = await (DeviceAgentNative as any).getScreenTree();
        const simplified = parseScreenHierarchy(raw);
        setHierarchy(simplified);
        setIsSimulated(false);
      } else {
        // Simulated / test screen DOM tree
        const mockRaw = [
          {
            id: 'top_bar',
            type: 'container',
            bounds: [0, 0, 1080, 120],
            children: [
              { id: 'back_btn', type: 'button', text: 'Back', bounds: [20, 20, 100, 100], clickable: true },
              { id: 'title_txt', type: 'text', text: 'Settings Overview', bounds: [120, 40, 600, 90], clickable: false },
            ],
          },
          {
            id: 'content_area',
            type: 'container',
            bounds: [0, 120, 1080, 1800],
            children: [
              { id: 'search_field', type: 'input', text: 'Search settings', bounds: [40, 160, 1040, 240], clickable: true },
              { id: 'password_field', type: 'input', text: 'secret_pass_123', isPassword: true, bounds: [40, 260, 1040, 340], clickable: true },
              { id: 'confirm_btn', type: 'button', text: 'Apply Changes', bounds: [100, 400, 980, 480], clickable: true },
            ],
          },
        ];
        const simplified = parseScreenHierarchy(mockRaw);
        setHierarchy(simplified);
        setIsSimulated(true);
      }
    } catch (e) {
      console.warn('[ScreenMirrorModal] Failed to fetch screen hierarchy:', e);
      setHierarchy([]);
    } finally {
      setLoading(false);
    }
  }, [setHierarchy, setLoading]);

  useEffect(() => {
    if (visible && (!hierarchy || hierarchy.length === 0)) {
      fetchScreenTree();
    }
  }, [visible, hierarchy, fetchScreenTree]);

  if (!visible) return null;

  const renderNode = (node: SimplifiedDomNode, depth = 0) => {
    const isSelected = selectedNode?.id === node.id;
    const typeColor =
      node.type === 'button'
        ? (aurora.acc1 || '#3b82f6')
        : node.type === 'input'
        ? '#10b981'
        : node.type === 'image'
        ? '#8b5cf6'
        : colors.textMuted;

    return (
      <View key={node.id} style={{ marginLeft: depth * 12, marginBottom: 6 }}>
        <Pressable
          onPress={() => setSelectedNode(node)}
          style={({ pressed }) => [
            styles.nodeRow,
            { borderColor: isSelected ? (aurora.acc1 || '#3b82f6') : colors.glassBorder },
            isSelected && { backgroundColor: `${aurora.acc1 || '#3b82f6'}15` },
            pressed && { opacity: 0.7 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={`DOM Node ${node.id}, type ${node.type}`}
        >
          <View style={[styles.typeBadge, { backgroundColor: `${typeColor}20`, borderColor: typeColor }]}>
            <Text style={[styles.typeBadgeText, { color: typeColor }]}>{node.type}</Text>
          </View>

          <Text style={[styles.nodeId, { color: colors.textMuted, fontSize: sizes.sub - 1 }]} numberOfLines={1}>
            {node.id}
          </Text>

          {node.text ? (
            <Text style={[styles.nodeText, { color: colors.text, fontSize: sizes.sub }]} numberOfLines={1}>
              "{node.text}"
            </Text>
          ) : null}

          {node.clickable ? (
            <Text style={[styles.clickableFlag, { color: aurora.acc1 || '#3b82f6' }]}>[tap]</Text>
          ) : null}
        </Pressable>

        {node.children && node.children.length > 0
          ? node.children.map((child) => renderNode(child, depth + 1))
          : null}
      </View>
    );
  };

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={() => setVisible(false)}
    >
      <View style={styles.overlay}>
        <View style={[styles.modalContainer, { backgroundColor: colors.skyBottom, borderColor: colors.glassBorder }]}>
          {/* Header */}
          <View style={styles.headerRow}>
            <View style={styles.titleCol}>
              <View style={styles.titleWithBadge}>
                <Text style={[styles.title, { color: colors.text, fontSize: sizes.title }]}>
                  📱 Screen Mirror
                </Text>
                <View
                  style={[
                    styles.sourceBadge,
                    {
                      backgroundColor: isSimulated ? 'rgba(234, 179, 8, 0.18)' : 'rgba(16, 185, 129, 0.18)',
                      borderColor: isSimulated ? '#eab308' : '#10b981',
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.sourceBadgeText,
                      { color: isSimulated ? '#eab308' : '#10b981' },
                    ]}
                  >
                    {isSimulated ? 'Simulated Fallback' : 'Live Capture'}
                  </Text>
                </View>
              </View>
              <Text style={[styles.subtitle, { color: colors.textMuted, fontSize: sizes.sub }]}>
                Read-only inspection of {isSimulated ? 'simulated demo' : 'active screen'} accessibility nodes
              </Text>
            </View>

            <Pressable
              onPress={() => setVisible(false)}
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel="Close screen mirror"
            >
              <Text style={[styles.closeBtnText, { color: colors.textMuted }]}>✕</Text>
            </Pressable>
          </View>

          {/* Privacy Note */}
          <View style={[styles.banner, { backgroundColor: `${aurora.acc1 || '#3b82f6'}15`, borderColor: colors.glassBorder }]}>
            <Text style={[styles.bannerText, { color: colors.textMuted, fontSize: sizes.sub - 1 }]}>
              🔒 Read-Only: Password fields masked. No touches can be injected from this preview.
            </Text>
          </View>

          {/* Simulated Demo Notice */}
          {isSimulated ? (
            <View style={[styles.banner, { backgroundColor: 'rgba(234, 179, 8, 0.12)', borderColor: 'rgba(234, 179, 8, 0.35)', marginTop: 8 }]}>
              <Text style={[styles.bannerText, { color: '#eab308', fontSize: sizes.sub - 1 }]}>
                🧪 Demo Preview: Live accessibility tree is unavailable on this platform. Displaying simulated sample hierarchy.
              </Text>
            </View>
          ) : null}

          {/* Body Content */}
          <View style={styles.body}>
            {loading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={aurora.acc1} />
                <Text style={[styles.loadingText, { color: colors.textMuted, fontSize: sizes.sub }]}>
                  Parsing screen hierarchy...
                </Text>
              </View>
            ) : hierarchy && hierarchy.length > 0 ? (
              <ScrollView style={styles.treeScroll} contentContainerStyle={styles.treeContent}>
                {hierarchy.map((rootNode) => renderNode(rootNode, 0))}
              </ScrollView>
            ) : (
              <View style={styles.emptyContainer}>
                <Text style={[styles.emptyText, { color: colors.textMuted, fontSize: sizes.sub }]}>
                  No active accessibility tree captured. Tap Refresh to scan.
                </Text>
              </View>
            )}

            {/* Selected Node Details Box */}
            {selectedNode ? (
              <Card style={styles.detailsCard}>
                <Text style={[styles.detailsTitle, { color: colors.text, fontSize: sizes.sub }]}>
                  Selected: <Text style={{ fontWeight: 'bold' }}>{selectedNode.id}</Text> ({selectedNode.type})
                </Text>
                <Text style={[styles.detailsMeta, { color: colors.textMuted, fontSize: sizes.sub - 1 }]}>
                  Bounds: [{selectedNode.bounds.join(', ')}] • Clickable: {selectedNode.clickable ? 'Yes' : 'No'}
                </Text>
                {selectedNode.text ? (
                  <Text style={[styles.detailsMeta, { color: colors.text, fontSize: sizes.sub }]}>
                    Text: "{selectedNode.text}"
                  </Text>
                ) : null}
              </Card>
            ) : null}
          </View>

          {/* Action Row */}
          <View style={styles.actionRow}>
            <Pressable
              onPress={fetchScreenTree}
              style={({ pressed }) => [
                styles.refreshBtn,
                { backgroundColor: aurora.acc1 || '#3b82f6' },
                pressed && { opacity: 0.7 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Refresh screen hierarchy"
            >
              <Text style={styles.refreshBtnText}>🔄 Refresh Screen</Text>
            </Pressable>

            <Pressable
              onPress={() => setVisible(false)}
              style={({ pressed }) => [
                styles.doneBtn,
                { backgroundColor: colors.glass, borderColor: colors.glassBorder },
                pressed && { opacity: 0.7 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Close screen mirror modal"
            >
              <Text style={[styles.doneBtnText, { color: colors.text }]}>Done</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalContainer: {
    width: '100%',
    maxWidth: 480,
    maxHeight: '90%',
    borderRadius: 16,
    borderWidth: 1,
    padding: 18,
    elevation: 5,
    shadowColor: DEFAULT_ELEVATION.e2.shadowColor,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  titleCol: {
    flex: 1,
  },
  title: {
    fontWeight: 'bold',
  },
  titleWithBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  sourceBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: 1,
  },
  sourceBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  subtitle: {
    marginTop: 2,
  },
  closeBtn: {
    padding: 6,
    marginLeft: 8,
  },
  closeBtnText: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  banner: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 12,
  },
  bannerText: {
    textAlign: 'center',
  },
  body: {
    maxHeight: 380,
    marginBottom: 14,
  },
  loadingContainer: {
    paddingVertical: 40,
    alignItems: 'center',
    gap: 10,
  },
  loadingText: {},
  emptyContainer: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  emptyText: {
    textAlign: 'center',
  },
  treeScroll: {
    maxHeight: 280,
  },
  treeContent: {
    paddingVertical: 4,
  },
  nodeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    gap: 8,
  },
  typeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
  },
  typeBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  nodeId: {
    fontWeight: '500',
  },
  nodeText: {
    flex: 1,
  },
  clickableFlag: {
    fontSize: 11,
    fontWeight: '600',
  },
  detailsCard: {
    marginTop: 10,
    padding: 10,
  },
  detailsTitle: {
    marginBottom: 2,
  },
  detailsMeta: {
    lineHeight: 16,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  refreshBtn: {
    flex: 1,
    height: 44,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  refreshBtnText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  doneBtn: {
    flex: 1,
    height: 44,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  doneBtnText: {
    fontWeight: '600',
    fontSize: 14,
  },
});
