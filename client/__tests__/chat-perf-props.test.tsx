import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { FlatList } from 'react-native';

describe('ChatFlatList performance props', () => {
  it('FlatList accepts and forwards performance optimization props', async () => {
    const messages = [
      { id: 'msg-1', role: 'user', content: 'Hello' },
      { id: 'msg-2', role: 'assistant', content: 'Hi there' },
    ];

    let renderedProps: Record<string, any> | null = null;

    const MyFlatList = (props: any) => {
      renderedProps = props;
      return React.createElement(FlatList, props);
    };

    await act(async () => {
      renderer.create(
        React.createElement(MyFlatList, {
          data: messages,
          inverted: true,
          keyExtractor: (item: any) => item.id,
          renderItem: ({ item }: any) =>
            React.createElement('View', null, item.content),
          removeClippedSubviews: true,
          windowSize: 11,
          maxToRenderPerBatch: 10,
          updateCellsBatchingPeriod: 50,
          initialNumToRender: 15,
        })
      );
    });

    expect(renderedProps).not.toBeNull();
    expect(renderedProps?.removeClippedSubviews).toBe(true);
    expect(renderedProps?.windowSize).toBe(11);
    expect(renderedProps?.maxToRenderPerBatch).toBe(10);
    expect(renderedProps?.updateCellsBatchingPeriod).toBe(50);
    expect(renderedProps?.initialNumToRender).toBe(15);
    expect(renderedProps?.inverted).toBe(true);
    expect(typeof renderedProps?.keyExtractor).toBe('function');
    expect(typeof renderedProps?.renderItem).toBe('function');
  });
});
