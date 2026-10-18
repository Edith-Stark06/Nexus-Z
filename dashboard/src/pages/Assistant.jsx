import ChatPanel from "../components/ChatPanel";
import Layout from "./Layout";

// The assistant page. The chat never uses sample data, so the layout's "sample data" badge does not apply here.
export default function Assistant() {
  return (
    <Layout usingMock={false}>
      <ChatPanel />
    </Layout>
  );
}
