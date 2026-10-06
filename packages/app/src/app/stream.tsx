import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { GlobalStreamScreen } from "@/companion-stream/global-screen";
export default function StreamRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <GlobalStreamScreen />
    </HostRouteBootstrapBoundary>
  );
}
