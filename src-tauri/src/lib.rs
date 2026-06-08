use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::str::FromStr;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ValidateResult {
    pub valid: bool,
    pub error: Option<String>,
    pub error_line: Option<usize>,
    pub error_col: Option<usize>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SearchResult {
    pub path: String,
    pub key: Option<String>,
    pub value: Option<String>,
    pub match_type: String, // "key" or "value"
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DiffItem {
    pub path: String,
    pub diff_type: String, // "added", "removed", "changed"
    pub left: Option<String>,
    pub right: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct JsonPathResult {
    pub results: Vec<String>,
    pub paths: Vec<String>,
}

// --- Format ---
#[tauri::command]
fn format_json(input: String, indent: u8) -> Result<String, String> {
    let v: Value = serde_json::from_str(&input).map_err(|e| format!("Invalid JSON: {}", e))?;
    let mut buf = Vec::new();
    let indent_str = " ".repeat(indent as usize);
    let mut ser = serde_json::Serializer::with_formatter(
        &mut buf,
        serde_json::ser::PrettyFormatter::with_indent(indent_str.as_bytes()),
    );
    v.serialize(&mut ser).map_err(|e| format!("Format error: {}", e))?;
    String::from_utf8(buf).map_err(|e| format!("UTF-8 error: {}", e))
}

// --- Minify ---
#[tauri::command]
fn minify_json(input: String) -> Result<String, String> {
    let v: Value = serde_json::from_str(&input).map_err(|e| format!("Invalid JSON: {}", e))?;
    serde_json::to_string(&v).map_err(|e| format!("Minify error: {}", e))
}

// --- Validate ---
#[tauri::command]
fn validate_json(input: String) -> ValidateResult {
    match serde_json::from_str::<Value>(&input) {
        Ok(_) => ValidateResult {
            valid: true,
            error: None,
            error_line: None,
            error_col: None,
        },
        Err(e) => ValidateResult {
            valid: false,
            error: Some(e.to_string()),
            error_line: Some(e.line()),
            error_col: Some(e.column()),
        },
    }
}

// --- Schema Validate ---
#[tauri::command]
fn validate_schema(json: String, schema: String) -> Result<ValidateResult, String> {
    let instance: Value =
        serde_json::from_str(&json).map_err(|e| format!("Invalid JSON: {}", e))?;
    let schema_json: Value =
        serde_json::from_str(&schema).map_err(|e| format!("Invalid Schema JSON: {}", e))?;

    let compiled = jsonschema::validator_for(&schema_json)
        .map_err(|e| format!("Invalid Schema: {}", e))?;

    let result = compiled.validate(&instance);
    match result {
        Ok(()) => Ok(ValidateResult {
            valid: true,
            error: None,
            error_line: None,
            error_col: None,
        }),
        Err(error) => {
            Ok(ValidateResult {
                valid: false,
                error: Some(error.to_string()),
                error_line: None,
                error_col: None,
            })
        }
    }
}

// --- Search ---
#[tauri::command]
fn search_json(
    input: String,
    query: String,
    case_sensitive: bool,
    keys_only: bool,
) -> Result<Vec<SearchResult>, String> {
    let v: Value =
        serde_json::from_str(&input).map_err(|e| format!("Invalid JSON: {}", e))?;

    let query_lower = if case_sensitive {
        query.clone()
    } else {
        query.to_lowercase()
    };

    let mut results = Vec::new();
    search_value(&v, &query, &query_lower, case_sensitive, keys_only, "$", &mut results);
    Ok(results)
}

fn matches_query(s: &str, query: &str, query_lower: &str, case_sensitive: bool) -> bool {
    if case_sensitive {
        s.contains(query)
    } else {
        s.to_lowercase().contains(query_lower)
    }
}

fn search_value(
    v: &Value,
    query: &str,
    query_lower: &str,
    case_sensitive: bool,
    keys_only: bool,
    current_path: &str,
    results: &mut Vec<SearchResult>,
) {
    match v {
        Value::Object(map) => {
            for (key, val) in map {
                let path = format!("{}.{}", current_path, key);

                // Check key match
                if matches_query(key, query, query_lower, case_sensitive) {
                    results.push(SearchResult {
                        path: path.clone(),
                        key: Some(key.clone()),
                        value: if keys_only {
                            None
                        } else {
                            Some(val.to_string())
                        },
                        match_type: "key".to_string(),
                    });
                }

                // Check value match (only if not keys_only)
                if !keys_only {
                    if let Value::String(s) = val {
                        if matches_query(s, query, query_lower, case_sensitive) {
                            results.push(SearchResult {
                                path: path.clone(),
                                key: Some(key.clone()),
                                value: Some(s.clone()),
                                match_type: "value".to_string(),
                            });
                        }
                    } else if let Value::Number(n) = val {
                        let n_str = n.to_string();
                        if matches_query(&n_str, query, query_lower, case_sensitive) {
                            results.push(SearchResult {
                                path: path.clone(),
                                key: Some(key.clone()),
                                value: Some(n_str),
                                match_type: "value".to_string(),
                            });
                        }
                    } else if let Value::Bool(b) = val {
                        let b_str = b.to_string();
                        if matches_query(&b_str, query, query_lower, case_sensitive) {
                            results.push(SearchResult {
                                path: path.clone(),
                                key: Some(key.clone()),
                                value: Some(b_str),
                                match_type: "value".to_string(),
                            });
                        }
                    }
                    // nested objects/arrays recurse handled below
                }

                // Recurse for deeper levels
                if matches!(val, Value::Object(_) | Value::Array(_)) {
                    search_value(val, query, query_lower, case_sensitive, keys_only, &path, results);
                }
            }
        }
        Value::Array(arr) => {
            for (i, val) in arr.iter().enumerate() {
                let path = format!("{}[{}]", current_path, i);
                if !keys_only {
                    if let Value::String(s) = val {
                        if matches_query(s, query, query_lower, case_sensitive) {
                            results.push(SearchResult {
                                path: path.clone(),
                                key: None,
                                value: Some(s.clone()),
                                match_type: "value".to_string(),
                            });
                        }
                    }
                }
                if matches!(val, Value::Object(_) | Value::Array(_)) {
                    search_value(val, query, query_lower, case_sensitive, keys_only, &path, results);
                }
            }
        }
        _ => {}
    }
}

// --- Diff ---
#[tauri::command]
fn diff_json(left: String, right: String) -> Result<Vec<DiffItem>, String> {
    let lv: Value =
        serde_json::from_str(&left).map_err(|e| format!("Invalid left JSON: {}", e))?;
    let rv: Value =
        serde_json::from_str(&right).map_err(|e| format!("Invalid right JSON: {}", e))?;

    let mut diffs = Vec::new();
    compare_values(&lv, &rv, "$", &mut diffs);
    Ok(diffs)
}

fn compare_values(left: &Value, right: &Value, path: &str, diffs: &mut Vec<DiffItem>) {
    match (left, right) {
        (Value::Object(lm), Value::Object(rm)) => {
            let mut all_keys: Vec<&String> = Vec::new();
            let mut seen: HashMap<&String, bool> = HashMap::new();
            for k in lm.keys() {
                if !seen.contains_key(k) {
                    all_keys.push(k);
                    seen.insert(k, true);
                }
            }
            for k in rm.keys() {
                if !seen.contains_key(k) {
                    all_keys.push(k);
                    seen.insert(k, true);
                }
            }

            for key in &all_keys {
                let child_path = format!("{}.{}", path, key);
                match (lm.get(*key), rm.get(*key)) {
                    (Some(lv), Some(rv)) => compare_values(lv, rv, &child_path, diffs),
                    (Some(lv), None) => diffs.push(DiffItem {
                        path: child_path,
                        diff_type: "removed".to_string(),
                        left: Some(lv.to_string()),
                        right: None,
                    }),
                    (None, Some(rv)) => diffs.push(DiffItem {
                        path: child_path,
                        diff_type: "added".to_string(),
                        left: None,
                        right: Some(rv.to_string()),
                    }),
                    (None, None) => {}
                }
            }
        }
        (Value::Array(la), Value::Array(ra)) => {
            let max_len = la.len().max(ra.len());
            for i in 0..max_len {
                let child_path = format!("{}[{}]", path, i);
                match (la.get(i), ra.get(i)) {
                    (Some(lv), Some(rv)) => compare_values(lv, rv, &child_path, diffs),
                    (Some(lv), None) => diffs.push(DiffItem {
                        path: child_path,
                        diff_type: "removed".to_string(),
                        left: Some(lv.to_string()),
                        right: None,
                    }),
                    (None, Some(rv)) => diffs.push(DiffItem {
                        path: child_path,
                        diff_type: "added".to_string(),
                        left: None,
                        right: Some(rv.to_string()),
                    }),
                    (None, None) => {}
                }
            }
        }
        _ => {
            if left != right {
                diffs.push(DiffItem {
                    path: path.to_string(),
                    diff_type: "changed".to_string(),
                    left: Some(left.to_string()),
                    right: Some(right.to_string()),
                });
            }
        }
    }
}

// --- JSONPath ---
#[tauri::command]
fn query_jsonpath(input: String, path: String) -> Result<JsonPathResult, String> {
    let v: Value =
        serde_json::from_str(&input).map_err(|e| format!("Invalid JSON: {}", e))?;

    let expr = jsonpath_rust::JsonPath::<Value>::from_str(&path)
        .map_err(|e| format!("Invalid JSONPath: {}", e))?;

    let results = expr.find_slice(&v);
    let mut result_strings = Vec::new();
    let mut result_paths = Vec::new();

    for r in &results {
        result_strings.push(serde_json::to_string_pretty(&r.clone().to_data()).unwrap_or_default());
        result_paths.push(
            r.clone()
                .to_path()
                .map(|p| p.to_string())
                .unwrap_or_default(),
        );
    }

    Ok(JsonPathResult {
        results: result_strings,
        paths: result_paths,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            format_json,
            minify_json,
            validate_json,
            validate_schema,
            search_json,
            diff_json,
            query_jsonpath,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
