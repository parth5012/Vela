import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { useConfigStore } from '../../store/useConfigStore';
import {
  AuroraScreen,
  Card,
  Label,
  PrimaryButton,
  useAurora,
} from '../../components/ui/settingsKit';
import {
  runJsonExtraction,
  getExtractionMockState,
  type ExtractionResult,
  type ExtractionStatus,
} from '../../utils/jsonExtraction';

/**
 * Wayfinder #298 — On-device JSON extraction ("local Jev", option 1 of #290).
 *
 * Flow: paste a JSON schema + source text, tap Extract. The phone runs Needle
 * locally (no network, no backend) with the schema as the ONLY declared tool,
 * so the decode grammar guarantees conformance. The pane shows
 * function_calls[0].arguments (typed JSON) + the engine's confidence badge —
 * no prose answer, no chat wrapper.
 *
 * Honesty (#291 / PRODUCT.md capability honesty): mock-fallback runs are
 * labeled "MOCK — NOT A REAL EXTRACTION" and never render JSON or a confidence
 * badge; missing engine confidence renders "confidence TBC (#298)" rather than
 * an invented number. Styles/components come from settingsKit — no new design
 * system.
 */
const STATUS_BADGES: Record<ExtractionStatus, { label: string; color: string }> = {
  success: { label: 'EXTRACTED', color: '#10b981' },
  refusal: { label: 'REFUSAL — NO RECORD', color: '#fb923c' },
  parse_failure: { label: 'PARSE FAILURE', color: '#ef4444' },
  engine_error: { label: 'ENGINE ERROR', color: '#ef4444' },
  invalid_schema: { label: 'INVALID SCHEMA', color: '#ef4444' },
  input_too_large: { label: 'INPUT TOO LARGE', color: '#ef4444' },
  mock: { label: 'MOCK — NOT A REAL EXTRACTION', color: '#fb923c' },
};

function Badge({ label, color }: { label: string; color: string }) {
  const { sizes } = useAurora();
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={label}
      style={[styles.badge, { borderColor: color, backgroundColor: 'rgba(0,0,0,0.3)' }]}
    >
      <Text style={{ color, fontSize: sizes.sub - 2, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}

export default function ExtractScreen() {
  const isLocalMode = useConfigStore((s) => s.isLocalMode);
  const localModelName = useConfigStore((s) => s.localModelName);
  const { colors, sizes } = useAurora();

  const [schemaText, setSchemaText] = useState('');
  const [sourceText, setSourceText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  // Capability honesty: recomputed every render so a fallback triggered by a
  // previous attempt is reflected immediately.
  const mockState = getExtractionMockState();

  const handleExtract = async () => {
    if (busy) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await runJsonExtraction(schemaText, sourceText);
      if (isMounted.current) setResult(res);
    } catch (err: any) {
      if (isMounted.current) {
        setResult({
          status: 'engine_error',
          mock: false,
          message: err?.message || String(err),
        });
      }
    } finally {
      if (isMounted.current) setBusy(false);
    }
  };

  const areaStyle = [
    styles.area,
    {
      backgroundColor: 'rgba(0,0,0,0.25)',
      borderColor: colors.glassBorder,
      color: colors.text,
      fontSize: sizes.text,
    },
  ];

  const statusBadge = result ? STATUS_BADGES[result.status] : null;

  return (
    <AuroraScreen
      title="JSON Extraction"
      subtitle={`Schema in, typed JSON + confidence out — fully on-device with ${localModelName}. No network.`}
    >
      {mockState.mock ? (
        <Card>
          <Label>Engine</Label>
          <View style={styles.badgeRow}>
            <Badge label="MOCK FALLBACK — ON-DEVICE BLOCKED" color="#fb923c" />
          </View>
          <Text style={[styles.note, { color: colors.textMuted, fontSize: sizes.sub }]}>
            {mockState.reason}
          </Text>
        </Card>
      ) : !isLocalMode ? (
        <Card>
          <Label>Engine</Label>
          <View style={styles.badgeRow}>
            <Badge label="PREVIEW — LOCAL MODE OFF" color="#fb923c" />
          </View>
          <Text style={[styles.note, { color: colors.textMuted, fontSize: sizes.sub }]}>
            Local mode is off. Extraction still runs entirely on-device (no network), but the
            local engine is not the active mode — treat results here as a preview.
          </Text>
        </Card>
      ) : null}

      <Card>
        <Label>JSON schema (the record)</Label>
        <TextInput
          value={schemaText}
          onChangeText={setSchemaText}
          placeholder={'{\n  "type": "object",\n  "properties": {\n    "vendor": { "type": "string" },\n    "total": { "type": "number" }\n  },\n  "required": ["vendor", "total"]\n}'}
          placeholderTextColor={colors.textDark}
          multiline
          textAlignVertical="top"
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="JSON schema input"
          style={[areaStyle, styles.schemaArea]}
        />
      </Card>

      <Card>
        <Label>Source text</Label>
        <TextInput
          style={[areaStyle, styles.sourceArea]}
          value={sourceText}
          onChangeText={setSourceText}
          placeholder="Paste the text to extract from (invoice, email, message, …)"
          placeholderTextColor={colors.textDark}
          multiline
          textAlignVertical="top"
          accessibilityLabel="Source text input"
        />
      </Card>

      <PrimaryButton
        label="Extract"
        onPress={handleExtract}
        loading={busy}
        disabled={!schemaText.trim() || !sourceText.trim()}
      />

      {result && statusBadge ? (
        <Card>
          <View style={styles.badgeRow}>
            <Badge label={statusBadge.label} color={statusBadge.color} />
            {result.status === 'success' ? (
              <Badge
                label={
                  result.confidence !== undefined
                    ? `confidence ${result.confidence.toFixed(2)}`
                    : 'confidence TBC (#298)'
                }
                color={result.confidence !== undefined ? '#10b981' : '#fb923c'}
              />
            ) : null}
            {result.status === 'success' && !isLocalMode ? (
              <Badge label="PREVIEW — LOCAL MODE OFF" color="#fb923c" />
            ) : null}
          </View>

          {result.status === 'success' ? (
            <Text
              selectable
              accessibilityLabel="Extraction result JSON"
              style={[styles.json, { backgroundColor: 'rgba(0,0,0,0.35)', color: colors.text }]}
            >
              {result.json}
            </Text>
          ) : (
            <>
              <Text style={{ color: colors.text, fontSize: sizes.sub, lineHeight: 18 }}>
                {result.status === 'mock'
                  ? `${result.message || ''} ${result.mockReason || ''}`.trim()
                  : result.message}
              </Text>
              {result.raw && result.status !== 'mock' ? (
                <Text
                  selectable
                  numberOfLines={8}
                  style={[styles.json, { color: colors.textMuted, fontSize: sizes.sub - 1 }]}
                >
                  {result.raw}
                </Text>
              ) : null}
            </>
          )}
        </Card>
      ) : null}
    </AuroraScreen>
  );
}

const styles = StyleSheet.create({
  area: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 8,
    marginTop: 6,
  },
  schemaArea: {
    minHeight: 140,
    fontFamily: 'monospace',
  },
  sourceArea: {
    minHeight: 110,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
    marginBottom: 6,
  },
  badge: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  note: {
    lineHeight: 16,
  },
  json: {
    fontFamily: 'monospace',
    fontSize: 13,
    lineHeight: 18,
    borderRadius: 8,
    padding: 10,
    marginTop: 4,
  },
});
