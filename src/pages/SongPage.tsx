/**
 * Song page — the workstation.
 *
 * Extracted from the app shell so the shell can host four top-level pages
 * instead of assuming there is only ever one. Nothing about the layout changed:
 * one of three responsive layouts fills the body, and the body is the only
 * flexible row in the shell grid.
 */
import { useViewport } from '../hooks/useViewport';
import { DesktopLayout } from '../components/shell/DesktopLayout';
import { TabletLayout } from '../components/shell/TabletLayout';
import { PhoneLayout } from '../components/shell/PhoneLayout';
import { RecordingBanner } from '../components/recording/RecordControls';

export default function SongPage() {
  const { layout } = useViewport();
  return (
    <>
      {layout !== 'phone' && <RecordingBanner />}
      {layout === 'desktop' ? (
        <DesktopLayout />
      ) : layout === 'tablet' ? (
        <TabletLayout />
      ) : (
        <PhoneLayout />
      )}
    </>
  );
}
