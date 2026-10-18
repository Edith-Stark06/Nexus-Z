import ChatPanel from "../components/ChatPanel";
import Layout from "./Layout";

// The assistant page. The chat never uses sample data: an invented answer would be worse than an honest error.
export default function Assistant() {
  return (
    <Layout title="Assistant" subtitle="Questions answered from NEXUS Z's own data">
      <ChatPanel />
    </Layout>
  );
}
