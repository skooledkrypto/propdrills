import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { PRIVACY_TEXT, TERMS_TEXT } from '../core';
import { useThemedStyles } from '../ui';

export type LegalDoc = 'terms' | 'privacy' | null;

/** Full-screen sheet rendering the bundled Terms of Use / Privacy Policy. */
export function LegalSheet({ doc, onClose }: { doc: LegalDoc; onClose: () => void }) {
  const { c } = useThemedStyles();
  const text = doc === 'terms' ? TERMS_TEXT : PRIVACY_TEXT;
  const title = doc === 'terms' ? 'Terms of Use' : 'Privacy Policy';
  return (
    <Modal visible={doc !== null} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: c.bg }}>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingHorizontal: 18,
            paddingTop: 54,
            paddingBottom: 12,
            borderBottomWidth: 1,
            borderBottomColor: c.line,
            backgroundColor: c.chrome,
          }}
        >
          <Text style={{ color: c.txt, fontSize: 16, fontWeight: '800' }}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={{ color: c.muted, fontSize: 17 }}>✕</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
          <Text style={{ color: c.txt, fontSize: 13, lineHeight: 20 }}>{text}</Text>
        </ScrollView>
      </View>
    </Modal>
  );
}
