import React, { useMemo } from 'react';
import { View, StyleSheet, Platform, Text, Pressable, ScrollView } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import Markdown from 'react-native-markdown-display';
import { parseContent } from '../../utils/latexExtractor';
import LatexRenderer from './LatexRenderer';
import { THEME_COLORS, FONT_SIZES, ACCENT_COLORS } from '../../utils/theme';
import MermaidRenderer from './MermaidRenderer';

interface RichTextProps {
  content: string;
  theme?: 'deep' | 'slate' | 'cyberpunk' | 'nordic' | 'dracula' | 'oled';
  fontSize?: 'small' | 'medium' | 'large';
  accentColor?: 'indigo' | 'emerald' | 'rose' | 'amber' | 'violet' | 'pink' | 'orange' | 'blue';
  colors?: typeof THEME_COLORS[keyof typeof THEME_COLORS];
  sizes?: typeof FONT_SIZES[keyof typeof FONT_SIZES];
  accentHex?: string;
  onCopyText?: (text: string) => void;
}

export default function RichText({
  content,
  theme = 'deep',
  fontSize = 'medium',
  accentColor = 'indigo',
  colors: colorsOverride,
  sizes: sizesOverride,
  accentHex: accentHexOverride,
  onCopyText,
}: RichTextProps) {
  const segments = parseContent(content);
  const colors = colorsOverride || THEME_COLORS[theme] || THEME_COLORS.deep;
  const sizes = sizesOverride || FONT_SIZES[fontSize] || FONT_SIZES.medium;
  const accentHex = accentHexOverride || ACCENT_COLORS[accentColor] || ACCENT_COLORS.indigo;

  const rules = useMemo(() => ({
    fence: (node: any) => {
      const codeText = node.content || '';
      const lang = node.info || '';

      if (lang.toLowerCase().trim() === 'mermaid') {
        return (
          <MermaidRenderer
            key={node.key}
            graph={codeText}
            theme={theme}
            fontSize={fontSize}
            accentColor={accentColor}
          />
        );
      }

      return (
          <View style={[styles.codeBlockWrapper, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <View style={[styles.codeBlockHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.codeBlockLang, { color: colors.textDark, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }]}>
                {lang.toUpperCase() || 'CODE'}
              </Text>
              <Pressable 
                style={({ pressed }) => [styles.codeCopyBtn, pressed && { opacity: 0.7, transform: [{ scale: 0.95 }] }]} 
                onPress={async () => {
                  await Clipboard.setStringAsync(codeText);
                }}
              >
                <Text style={{ color: colors.textMuted, fontSize: sizes.sub - 1, fontWeight: '600', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>Copy</Text>
              </Pressable>
            </View>
            <ScrollView horizontal={true} showsHorizontalScrollIndicator={true} style={{ width: '100%', maxWidth: '100%' }} contentContainerStyle={{ flexGrow: 1 }}>
              <Text style={[styles.codeText, { color: colors.text, fontSize: sizes.text - 1, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }]}>
                {codeText.replace(/\n$/, '')}
              </Text>
            </ScrollView>
          </View>
      );
    },
    code_block: (node: any) => {
      const codeText = node.content || '';
      return (
        <View key={node.key} style={[styles.codeBlockWrapper, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <View style={[styles.codeBlockHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.codeBlockLang, { color: colors.textDark, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }]}>CODE</Text>
            <Pressable 
              style={({ pressed }) => [styles.codeCopyBtn, pressed && { opacity: 0.7, transform: [{ scale: 0.95 }] }]} 
              onPress={async () => {
                await Clipboard.setStringAsync(codeText);
              }}
            >
              <Text style={{ color: colors.textMuted, fontSize: sizes.sub - 1, fontWeight: '600', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>Copy</Text>
            </Pressable>
          </View>
          <ScrollView horizontal={true} showsHorizontalScrollIndicator={true} style={{ width: '100%', maxWidth: '100%' }} contentContainerStyle={{ flexGrow: 1 }}>
            <Text style={[styles.codeText, { color: colors.text, fontSize: sizes.text - 1, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }]}>
              {codeText.replace(/\n$/, '')}
            </Text>
          </ScrollView>
        </View>
      );
    }
  }), [theme, fontSize, accentColor, colors, sizes]);

  const dynamicMarkdownStyles = useMemo(() => ({
    body: {
      color: colors.text,
      fontSize: sizes.text,
      lineHeight: sizes.text * 1.5,
    },
    link: {
      color: accentHex,
      textDecorationLine: 'underline' as const,
    },
    code_inline: {
      backgroundColor: colors.card,
      color: colors.text,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      paddingHorizontal: 5,
      paddingVertical: 1,
      borderRadius: 4,
      borderWidth: 1,
      borderColor: colors.border,
      fontSize: sizes.text - 1,
    },
    code_block: {
      backgroundColor: colors.background,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 8,
      padding: 12,
      marginVertical: 8,
      color: colors.text,
      fontSize: sizes.text - 1,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    },
    fence: {
      backgroundColor: colors.background,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 8,
      padding: 12,
      marginVertical: 8,
      color: colors.text,
      fontSize: sizes.text - 1,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    },
    blockquote: {
      backgroundColor: 'rgba(255, 255, 255, 0.03)',
      borderColor: accentHex,
      borderLeftWidth: 3,
      paddingHorizontal: 12,
      paddingVertical: 8,
      marginVertical: 8,
      borderRadius: 4,
      color: colors.textMuted,
      fontSize: sizes.text,
    },
    heading1: {
      color: colors.text,
      fontSize: sizes.title + 2,
      fontWeight: 'bold' as const,
      marginTop: 16,
      marginBottom: 8,
    },
    heading2: {
      color: colors.text,
      fontSize: sizes.title,
      fontWeight: 'bold' as const,
      marginTop: 14,
      marginBottom: 8,
    },
    heading3: {
      color: colors.text,
      fontSize: sizes.title - 2,
      fontWeight: 'bold' as const,
      marginTop: 12,
      marginBottom: 6,
    },
    bullet_list: {
      marginVertical: 8,
    },
    ordered_list: {
      marginVertical: 8,
    },
    list_item: {
      color: colors.text,
      marginVertical: 2,
      fontSize: sizes.text,
    },
    paragraph: {
      marginTop: 0,
      marginBottom: 8,
      flexWrap: 'wrap',
    },
    text: {
      flexWrap: 'wrap',
    },
    table: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 6,
      marginVertical: 8,
      overflow: 'hidden',
    },
    tableHeader: {
      backgroundColor: colors.card,
      borderBottomWidth: 1,
      borderColor: colors.border,
    },
    tr: {
      borderBottomWidth: 1,
      borderColor: colors.border,
      flexDirection: 'row',
    },
    td: {
      padding: 6,
    },
    th: {
      padding: 6,
      fontWeight: 'bold' as const,
    },
    strong: {
      fontWeight: 'bold' as const,
      color: colors.text,
    },
    em: {
      fontStyle: 'italic' as const,
    },
  }), [colors, sizes, accentHex]);

  return (
    <View style={styles.container}>
      {segments.map((segment, index) => {
        if (segment.type === 'markdown') {
          return <Markdown key={index} rules={rules} style={dynamicMarkdownStyles as any}>{segment.content}</Markdown>;
        } else if (segment.type === 'latex-inline') {
          return (
            <LatexRenderer
              key={index}
              formula={segment.content}
              displayMode={false}
            />
          );
        } else if (segment.type === 'latex-block') {
          return (
            <LatexRenderer
              key={index}
              formula={segment.content}
              displayMode={true}
            />
          );
        }
        return null;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'stretch',
    maxWidth: '100%',
    overflow: 'hidden',
  },
  codeBlockWrapper: {
    borderWidth: 1,
    borderRadius: 8,
    marginVertical: 8,
    overflow: 'hidden',
    alignSelf: 'stretch',
    maxWidth: '100%',
  },
  codeBlockHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderBottomWidth: 1,
  },
  codeBlockLang: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  codeCopyBtn: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  codeText: {
    padding: 12,
    lineHeight: 20,
  },
});
