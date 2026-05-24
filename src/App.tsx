import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Layout,
  Button,
  Space,
  Tabs,
  Tree,
  Input,
  Table,
  message,
  Splitter,
  Tag,
  Tooltip,
  Modal,
  Radio,
  Switch,
  Badge,
  Empty,
  Descriptions,
  Typography,
} from "antd";
import type { DataNode } from "antd/es/tree";
import {
  FormatPainterOutlined,
  CompressOutlined,
  CheckCircleOutlined,
  SearchOutlined,
  DiffOutlined,
  NodeIndexOutlined,
  CopyOutlined,
  DeleteOutlined,
  ExpandOutlined,
  ShrinkOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from "@ant-design/icons";
import CodeMirror from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { lintGutter, forEachDiagnostic } from "@codemirror/lint";
import { hoverTooltip } from "@codemirror/view";
import type { SearchResult, DiffItem, ValidateResult, JsonPathResult } from "./types";
import "./App.css";

const { Header, Content } = Layout;
const { Text } = Typography;

function jsonToTreeNodes(
  val: unknown,
  key: string,
  parentKey?: string,
  onNodeDoubleClick?: (key: string, value: string) => void,
): DataNode {
  const nodeKey = parentKey ? `${parentKey}.${key}` : key;

  if (val === null) {
    return {
      title: (
        <span>
          <Text strong style={{ color: "#1a1a1a" }}>{key}</Text>
          <Tag color="default" style={{ marginLeft: 8 }}>null</Tag>
        </span>
      ),
      key: nodeKey,
      isLeaf: true,
    };
  }

  if (typeof val === "boolean") {
    return {
      title: (
        <span>
          <Text strong style={{ color: "#1a1a1a" }}>{key}</Text>
          <Tag color="purple" style={{ marginLeft: 8 }}>{val.toString()}</Tag>
        </span>
      ),
      key: nodeKey,
      isLeaf: true,
    };
  }

  if (typeof val === "number") {
    return {
      title: (
        <span>
          <Text strong style={{ color: "#1a1a1a" }}>{key}</Text>
          <Tag color="blue" style={{ marginLeft: 8 }}>{val}</Tag>
        </span>
      ),
      key: nodeKey,
      isLeaf: true,
    };
  }

  if (typeof val === "string") {
    const display = val.length > 60 ? val.slice(0, 60) + "…" : val;
    return {
      title: (
        <span
          onDoubleClick={(e) => {
            e.stopPropagation();
            onNodeDoubleClick?.(nodeKey, val);
          }}
          style={{ cursor: "pointer" }}
          title="双击查看完整内容"
        >
          <Text strong style={{ color: "#1a1a1a" }}>{key}</Text>
          <Tag color="green" style={{ marginLeft: 8 }}>"{display}"</Tag>
        </span>
      ),
      key: nodeKey,
      isLeaf: true,
    };
  }

  if (Array.isArray(val)) {
    return {
      title: (
        <span>
          <Text strong style={{ color: "#1a1a1a" }}>{key}</Text>
          <Tag color="orange" style={{ marginLeft: 8 }}>[{val.length}]</Tag>
        </span>
      ),
      key: nodeKey,
      children: val.map((item, i) => jsonToTreeNodes(item, `[${i}]`, nodeKey, onNodeDoubleClick)),
    };
  }

  if (typeof val === "object") {
    const entries = Object.entries(val as Record<string, unknown>);
    return {
      title: (
        <span>
          <Text strong style={{ color: "#1a1a1a" }}>{key}</Text>
          <Tag color="cyan" style={{ marginLeft: 8 }}>{"{ }"} {entries.length}</Tag>
        </span>
      ),
      key: nodeKey,
      children: entries.map(([k, v]) => jsonToTreeNodes(v, k, nodeKey, onNodeDoubleClick)),
    };
  }

  return { title: String(val), key: nodeKey, isLeaf: true };
}

const fullWidthLintHover = hoverTooltip((view, pos) => {
  const diagnostics: { from: number; to: number; message: string }[] = [];
  forEachDiagnostic(view.state, (d, from, to) => {
    if (pos >= from && pos <= to) diagnostics.push({ from, to, message: d.message });
  });
  if (diagnostics.length === 0) return null;
  return {
    pos: Math.min(...diagnostics.map((d) => d.from)),
    end: Math.max(...diagnostics.map((d) => d.to)),
    above: true,
    create() {
      const dom = document.createElement("div");
      dom.style.cssText =
        "max-width:700px;padding:8px 12px;white-space:pre-wrap;word-break:break-word;background:#fff;border:1px solid #e8e8e8;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,0.15);font-size:13px;line-height:1.6;color:#333;";
      diagnostics.forEach((d, i) => {
        const el = dom.appendChild(document.createElement("div"));
        el.textContent = d.message;
        if (i < diagnostics.length - 1) el.style.borderBottom = "1px solid #f0f0f0";
      });
      return { dom };
    },
  };
});

export default function App() {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [indent, setIndent] = useState(2);
  const [treeData, setTreeData] = useState<DataNode[]>([]);
  const [treeExpanded, setTreeExpanded] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState("output");

  // Search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [keysOnly, setKeysOnly] = useState(false);

  // Diff
  const [diffLeft, setDiffLeft] = useState("");
  const [diffRight, setDiffRight] = useState("");
  const [diffResults, setDiffResults] = useState<DiffItem[]>([]);
  const [diffMode, setDiffMode] = useState(false);

  // Validate
  const [schemaInput, setSchemaInput] = useState("");
  const [validateResult, setValidateResult] = useState<ValidateResult | null>(null);
  const [schemaVisible, setSchemaVisible] = useState(false);

  // JSONPath
  const [jsonPathQuery, setJsonPathQuery] = useState("$..*");
  const [jsonPathResult, setJsonPathResult] = useState<JsonPathResult | null>(null);
  const [showInput, setShowInput] = useState(true);
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailKey, setDetailKey] = useState("");
  const [detailValue, setDetailValue] = useState("");

  const getAllKeys = (nodes: DataNode[]): string[] => {
    const keys: string[] = [];
    const walk = (list: DataNode[]) => {
      for (const n of list) {
        keys.push(n.key as string);
        if (n.children) walk(n.children);
      }
    };
    walk(nodes);
    return keys;
  };

  const parseTree = useCallback((jsonStr: string) => {
    try {
      const parsed = JSON.parse(jsonStr);
      const nodes = Array.isArray(parsed)
        ? [jsonToTreeNodes(parsed, "$", undefined, (k, v) => { setDetailKey(k); setDetailValue(v); setDetailVisible(true); })]
        : Object.entries(parsed).map(([k, v]) => jsonToTreeNodes(v, k, "$", (k, v) => { setDetailKey(k); setDetailValue(v); setDetailVisible(true); }));
      setTreeData(nodes);
      const firstLevelKeys = nodes.map((n) => n.key as string);
      setTreeExpanded(firstLevelKeys);
    } catch {
      setTreeData([]);
    }
  }, []);

  const handleFormat = async () => {
    try {
      const result = await invoke<string>("format_json", { input, indent });
      setOutput(result);
      setActiveTab("output");
      parseTree(result);
      message.success("格式化完成");
    } catch (e) {
      message.error(String(e));
    }
  };

  const handleMinify = async () => {
    try {
      const result = await invoke<string>("minify_json", { input });
      setOutput(result);
      setActiveTab("output");
      message.success("压缩完成");
    } catch (e) {
      message.error(String(e));
    }
  };

  const handleValidate = async () => {
    try {
      const result = await invoke<ValidateResult>("validate_json", { input });
      setValidateResult(result);
      setActiveTab("validate");
      if (result.valid) {
        message.success("合法的 JSON");
      } else {
        message.error(`第 ${result.error_line} 行, 第 ${result.error_col} 列有错误`);
      }
    } catch (e) {
      message.error(String(e));
    }
  };

  const handleSchemaValidate = async () => {
    try {
      const result = await invoke<ValidateResult>("validate_schema", {
        json: input,
        schema: schemaInput,
      });
      setValidateResult(result);
      setActiveTab("validate");
      if (result.valid) {
        message.success("Schema 校验通过");
      } else {
        message.error("Schema 校验失败");
      }
    } catch (e) {
      message.error(String(e));
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    try {
      const results = await invoke<SearchResult[]>("search_json", {
        input,
        query: searchQuery,
        caseSensitive,
        keysOnly,
      });
      setSearchResults(results);
      setActiveTab("search");
      message.info(`找到 ${results.length} 条匹配`);
    } catch (e) {
      message.error(String(e));
    }
  };

  const handleDiff = async () => {
    try {
      const results = await invoke<DiffItem[]>("diff_json", {
        left: diffLeft || input,
        right: diffRight,
      });
      setDiffResults(results);
      setActiveTab("diff");
      if (results.length === 0) {
        message.success("没有差异");
      } else {
        message.info(`找到 ${results.length} 条差异`);
      }
    } catch (e) {
      message.error(String(e));
    }
  };

  const handleJsonPath = async () => {
    try {
      const result = await invoke<JsonPathResult>("query_jsonpath", {
        input,
        path: jsonPathQuery,
      });
      setJsonPathResult(result);
      setActiveTab("jsonpath");
      message.info(`找到 ${result.results.length} 条结果`);
    } catch (e) {
      message.error(String(e));
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    message.success("已复制");
  };

  const searchColumns = [
    { title: "路径", dataIndex: "path", key: "path", width: 180, render: (v: string) => <Text code>{v}</Text> },
    { title: "类型", dataIndex: "match_type", key: "match_type", width: 70, render: (v: string) => <Tag color={v === "key" ? "blue" : "green"}>{v === "key" ? "键名" : "值"}</Tag> },
    { title: "键名", dataIndex: "key", key: "key", width: 100 },
    { title: "值", dataIndex: "value", key: "value", ellipsis: true },
  ];

  const diffColumns = [
    { title: "路径", dataIndex: "path", key: "path", width: 180, render: (v: string) => <Text code>{v}</Text> },
    { title: "类型", dataIndex: "diff_type", key: "diff_type", width: 80, render: (v: string) => {
      const c = v === "added" ? "green" : v === "removed" ? "red" : "orange";
      const label = v === "added" ? "新增" : v === "removed" ? "删除" : "变更";
      return <Tag color={c}>{label}</Tag>;
    }},
    { title: "原始值", dataIndex: "left", key: "left", ellipsis: true },
    { title: "新值", dataIndex: "right", key: "right", ellipsis: true },
  ];

  return (
    <Layout style={{ height: "100vh", background: "#f5f5f5" }}>
      {/* Header Toolbar */}
      <Header
        style={{
          background: "#fff",
          borderBottom: "1px solid #e8e8e8",
          padding: "0 16px",
          height: 44,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Space size="small" wrap>
          <Text strong style={{ color: "#333", marginRight: 8, fontSize: 15, letterSpacing: 0.5 }}>
            JSON 解析器
          </Text>
          <Tooltip title="格式化 JSON"><Button type="text" icon={<FormatPainterOutlined />} onClick={handleFormat}>格式化</Button></Tooltip>
          <Tooltip title="压缩 JSON"><Button type="text" icon={<CompressOutlined />} onClick={handleMinify}>压缩</Button></Tooltip>
          <Tooltip title="语法校验"><Button type="text" icon={<CheckCircleOutlined />} onClick={handleValidate}>校验</Button></Tooltip>
          <Button type="text" icon={<CheckCircleOutlined />} onClick={() => setSchemaVisible(true)}>Schema 校验</Button>
          <Tooltip title="搜索"><Button type="text" icon={<SearchOutlined />} onClick={handleSearch}>搜索</Button></Tooltip>
          <Tooltip title="JSON 对比">
            <Button
              type={diffMode ? "primary" : "text"}
              icon={<DiffOutlined />}
              onClick={() => { setDiffMode(!diffMode); if (!diffMode) setActiveTab("diff"); }}
              ghost={!diffMode}
            >对比</Button>
          </Tooltip>
          <Tooltip title="JSONPath 查询"><Button type="text" icon={<NodeIndexOutlined />} onClick={handleJsonPath}>JSONPath</Button></Tooltip>
          <Tooltip title={showInput ? "隐藏输入面板" : "显示输入面板"}>
            <Button
              type="text"
              icon={showInput ? <MenuFoldOutlined /> : <MenuUnfoldOutlined />}
              onClick={() => setShowInput(!showInput)}
            />
          </Tooltip>
        </Space>
        <Space size={4}>
          <Text type="secondary" style={{ fontSize: 11 }}>缩进:</Text>
          <Radio.Group value={indent} onChange={(e) => setIndent(e.target.value)} size="small" optionType="button" buttonStyle="solid">
            <Radio.Button value={2}>2</Radio.Button>
            <Radio.Button value={4}>4</Radio.Button>
            <Radio.Button value={8}>Tab</Radio.Button>
          </Radio.Group>
        </Space>
      </Header>

      {/* Search bar */}
      <div style={{ background: "#fafafa", borderBottom: "1px solid #e8e8e8", padding: "5px 16px", display: "flex", alignItems: "center", gap: 10 }}>
        <Input.Search placeholder="搜索 JSON..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} onSearch={handleSearch} style={{ maxWidth: 340 }} size="small" allowClear />
        <Text type="secondary" style={{ fontSize: 11 }}>区分大小写</Text>
        <Switch checked={caseSensitive} onChange={setCaseSensitive} size="small" />
        <Text type="secondary" style={{ fontSize: 11 }}>仅键名</Text>
        <Switch checked={keysOnly} onChange={setKeysOnly} size="small" />
      </div>

      <Content style={{ flex: 1, overflow: "hidden" }}>
        {diffMode ? (
          <Splitter style={{ height: "100%" }}>
            <Splitter.Panel defaultSize="35%" min="20%">
              <div className="panel">
                <div className="panel-header" style={{ color: "#cf1322", fontWeight: 500 }}>原始</div>
                <div className="panel-body">
                  <CodeMirror value={diffLeft || input} onChange={setDiffLeft} height="100%" style={{ height: "100%" }} extensions={[json()]} basicSetup={{ lineNumbers: true, foldGutter: true, autocompletion: false }} />
                </div>
              </div>
            </Splitter.Panel>
            <Splitter.Panel defaultSize="35%" min="20%">
              <div className="panel">
                <div className="panel-header" style={{ color: "#389e0d", fontWeight: 500 }}>修改后</div>
                <div className="panel-body">
                  <CodeMirror value={diffRight} onChange={setDiffRight} height="100%" style={{ height: "100%" }} extensions={[json()]} basicSetup={{ lineNumbers: true, foldGutter: true, autocompletion: false }} />
                </div>
              </div>
            </Splitter.Panel>
            <Splitter.Panel defaultSize="30%" min="15%">
              <div className="panel">
                <div className="panel-header">
                  对比结果
                  <Badge count={diffResults.length} size="small" style={{ marginLeft: 8, backgroundColor: diffResults.length > 0 ? "#fa8c16" : "#d9d9d9" }} />
                  <Button size="small" type="primary" onClick={handleDiff} style={{ marginLeft: "auto" }}>开始对比</Button>
                </div>
                <div className="panel-body" style={{ padding: 0 }}>
                  {diffResults.length === 0 ? <Empty description="点击「开始对比」" style={{ marginTop: 60 }} /> : (
                    <Table dataSource={diffResults.map((d, i) => ({ ...d, key: i }))} columns={diffColumns} size="small" pagination={false} scroll={{ y: "100%" }} />
                  )}
                </div>
              </div>
            </Splitter.Panel>
          </Splitter>
        ) : (
          <Splitter style={{ height: "100%" }}>
            {showInput && (
            <Splitter.Panel defaultSize="45%" min="25%">
              <div className="panel">
                <div className="panel-header">
                  JSON 输入
                  <Space size="small" style={{ marginLeft: "auto" }}>
                    <Button size="small" type="text" icon={<CopyOutlined />} onClick={() => handleCopy(input)} />
                    <Button size="small" type="text" icon={<DeleteOutlined />} onClick={() => { setInput(""); setTreeData([]); }} />
                  </Space>
                </div>
                <div className="panel-body">
                  <CodeMirror value={input} onChange={(v) => { setInput(v); parseTree(v); }} height="100%" style={{ height: "100%" }} extensions={[lintGutter(), fullWidthLintHover, json()]} basicSetup={{ lineNumbers: true, foldGutter: true, autocompletion: false }} />
                </div>
              </div>
            </Splitter.Panel>
            )}
            <Splitter.Panel defaultSize={showInput ? "55%" : "100%"} min="25%">
              <div className="panel">
                <div className="panel-header">
                  <Tabs
                    activeKey={activeTab}
                    onChange={setActiveTab}
                    size="small"
                    style={{ marginBottom: 0, flex: 1 }}
                    tabBarStyle={{ marginBottom: 0, borderBottom: "none" }}
                    items={[
                      { key: "output", label: "输出" },
                      { key: "tree", label: "树形视图" },
                      { key: "search", label: <span>搜索结果 {searchResults.length > 0 && <Badge count={searchResults.length} size="small" style={{ marginLeft: 4 }} />}</span> },
                      { key: "validate", label: "校验结果" },
                      { key: "jsonpath", label: "JSONPath" },
                    ]}
                  />
                </div>
                <div className="panel-body" style={{ padding: activeTab === "output" ? 0 : 12 }}>
                  {activeTab === "output" && (
                    <div style={{ height: "100%", position: "relative" }}>
                      <CodeMirror value={output} height="100%" style={{ height: "100%" }} extensions={[json()]} readOnly editable={false} basicSetup={{ lineNumbers: true, foldGutter: true }} />
                      {output && <Button size="small" type="text" icon={<CopyOutlined />} onClick={() => handleCopy(output)} style={{ position: "absolute", top: 6, right: 10, zIndex: 10 }} />}
                    </div>
                  )}

                  {activeTab === "tree" && (
                    treeData.length > 0 ? (
                      <div>
                        <div style={{ marginBottom: 8, display: "flex", gap: 8 }}>
                          <Button
                            size="small"
                            icon={<ExpandOutlined />}
                            onClick={() => setTreeExpanded(getAllKeys(treeData))}
                          >
                            全部展开
                          </Button>
                          <Button
                            size="small"
                            icon={<ShrinkOutlined />}
                            onClick={() => setTreeExpanded([])}
                          >
                            全部折叠
                          </Button>
                        </div>
                        <Tree
                          showLine
                          showIcon
                          expandedKeys={treeExpanded}
                          onExpand={(keys) => setTreeExpanded(keys as string[])}
                          treeData={treeData}
                          style={{ fontSize: 13 }}
                        />
                      </div>
                    ) : <Empty description="输入合法的 JSON" style={{ marginTop: 60 }} />
                  )}

                  {activeTab === "search" && (
                    searchResults.length > 0 ? (
                      <Table dataSource={searchResults.map((s, i) => ({ ...s, key: i }))} columns={searchColumns} size="small" pagination={{ pageSize: 50, size: "small" }} scroll={{ y: "calc(100vh - 200px)" }} />
                    ) : <Empty description="搜索键名或值" style={{ marginTop: 60 }} />
                  )}

                  {activeTab === "validate" && (
                    validateResult ? (
                      <Descriptions column={1} size="small" bordered style={{ maxWidth: 500 }}>
                        <Descriptions.Item label="Status">{validateResult.valid ? <Tag color="success">Valid</Tag> : <Tag color="error">Invalid</Tag>}</Descriptions.Item>
                        {validateResult.error && (
                          <>
                            <Descriptions.Item label="Error"><Text type="danger">{validateResult.error}</Text></Descriptions.Item>
                            {validateResult.error_line !== null && <Descriptions.Item label="Line">{validateResult.error_line}</Descriptions.Item>}
                            {validateResult.error_col !== null && <Descriptions.Item label="Column">{validateResult.error_col}</Descriptions.Item>}
                          </>
                        )}
                      </Descriptions>
                    ) : <Empty description="点击「校验」" style={{ marginTop: 60 }} />
                  )}

                  {activeTab === "jsonpath" && (
                    <div>
                      <Input.Search placeholder="例如 $..name" value={jsonPathQuery} onChange={(e) => setJsonPathQuery(e.target.value)} onSearch={handleJsonPath} enterButton="查询" style={{ maxWidth: 500, marginBottom: 16 }} />
                      {jsonPathResult && jsonPathResult.results.length > 0 ? jsonPathResult.results.map((r, i) => (
                        <div key={i} style={{ background: "#fafafa", border: "1px solid #e8e8e8", borderRadius: 6, padding: 12, marginBottom: 12, position: "relative" }}>
                          <div style={{ fontSize: 11, color: "#999", marginBottom: 6 }}>Path: <Text code style={{ fontSize: 11 }}>{jsonPathResult.paths[i] || `Result ${i + 1}`}</Text></div>
                          <CodeMirror value={r} height="auto" extensions={[json()]} readOnly editable={false} basicSetup={{ lineNumbers: true, foldGutter: true }} />
                          <Button size="small" type="text" icon={<CopyOutlined />} onClick={() => handleCopy(r)} style={{ position: "absolute", top: 8, right: 8 }} />
                        </div>
                      )) : jsonPathResult ? <Empty description="无结果" /> : <Empty description="输入 JSONPath 表达式" />}
                    </div>
                  )}
                </div>
              </div>
            </Splitter.Panel>
          </Splitter>
        )}
      </Content>

      {/* Schema Modal */}
      <Modal title="JSON Schema 校验" open={schemaVisible} onCancel={() => setSchemaVisible(false)} onOk={handleSchemaValidate} width={750} okText="校验">
        <Text type="secondary" style={{ display: "block", marginBottom: 8 }}>粘贴 JSON Schema:</Text>
        <CodeMirror value={schemaInput} onChange={setSchemaInput} height="250px" extensions={[json()]} basicSetup={{ lineNumbers: true, foldGutter: true }} />
      </Modal>

      {/* Tree Node Detail Modal */}
      <Modal
        title={detailKey}
        open={detailVisible}
        onCancel={() => setDetailVisible(false)}
        footer={null}
        width={700}
      >
        <CodeMirror
          value={detailValue}
          height="auto"
          maxHeight="400px"
          extensions={[json()]}
          readOnly
          editable={false}
          basicSetup={{ lineNumbers: true, foldGutter: true }}
        />
      </Modal>
    </Layout>
  );
}
