import '@shopify/flash-list';

declare module '@shopify/flash-list' {
  interface FlashListProps<TItem> {
    estimatedItemSize?: number;
  }
}
