from pathlib import Path
import re

main_files = list(Path('android/app/src/main/java').rglob('MainActivity.java'))
if len(main_files) != 1:
    raise SystemExit(f'Expected one MainActivity.java, found {len(main_files)}')
main = main_files[0]
text = main.read_text()
match = re.search(r'^package\s+([\w.]+);', text, re.M)
if not match:
    raise SystemExit('Could not determine Android package name')
package = match.group(1)
plugin_dir = main.parent
plugin = plugin_dir / 'RenderExportPlugin.java'
plugin.write_text(f'''package {package};

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.database.Cursor;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;

@CapacitorPlugin(name = "RenderExport")
public class RenderExportPlugin extends Plugin {{
  private static final String PREFS = "editor3d_render_export";
  private static final String TREE_KEY = "tree_uri";

  @PluginMethod
  public void chooseFolder(PluginCall call) {{
    Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
    startActivityForResult(call, intent, "folderPicked");
  }}

  @ActivityCallback
  private void folderPicked(PluginCall call, ActivityResult result) {{
    if (call == null) return;
    if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {{ call.reject("canceled"); return; }}
    Uri tree = result.getData().getData();
    int flags = result.getData().getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
    try {{ getContext().getContentResolver().takePersistableUriPermission(tree, flags); }} catch (Exception e) {{ call.reject("Could not keep folder permission: " + e.getMessage()); return; }}
    getContext().getSharedPreferences(PREFS, 0).edit().putString(TREE_KEY, tree.toString()).apply();
    JSObject ret = new JSObject(); ret.put("displayName", queryName(tree)); call.resolve(ret);
  }}

  @PluginMethod
  public void getFolder(PluginCall call) {{
    String value = getContext().getSharedPreferences(PREFS, 0).getString(TREE_KEY, null);
    JSObject ret = new JSObject(); ret.put("displayName", value == null ? "" : queryName(Uri.parse(value))); call.resolve(ret);
  }}

  @PluginMethod
  public void saveFile(PluginCall call) {{
    String name = call.getString("name"); String mime = call.getString("mimeType", "application/octet-stream"); String encoded = call.getString("data");
    if (name == null || encoded == null) {{ call.reject("Missing file name or data"); return; }}
    String value = getContext().getSharedPreferences(PREFS, 0).getString(TREE_KEY, null);
    if (value == null) {{ call.reject("Choose an export folder first"); return; }}
    try {{
      Uri tree = Uri.parse(value);
      Uri parent = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
      Uri file = DocumentsContract.createDocument(getContext().getContentResolver(), parent, mime, name);
      if (file == null) throw new IllegalStateException("Android could not create the export file");
      byte[] bytes = Base64.decode(encoded, Base64.DEFAULT);
      try (OutputStream output = getContext().getContentResolver().openOutputStream(file, "w")) {{
        if (output == null) throw new IllegalStateException("Android could not open the export file");
        output.write(bytes); output.flush();
      }}
      JSObject ret = new JSObject(); ret.put("name", name); ret.put("uri", file.toString()); call.resolve(ret);
    }} catch (Exception e) {{ call.reject("Could not save export: " + e.getMessage(), e); }}
  }}

  private String queryName(Uri uri) {{
    try (Cursor cursor = getContext().getContentResolver().query(uri, new String[]{{DocumentsContract.Document.COLUMN_DISPLAY_NAME}}, null, null, null)) {{
      if (cursor != null && cursor.moveToFirst()) return cursor.getString(0);
    }} catch (Exception ignored) {{ }}
    return "Carpeta elegida";
  }}
}}
''')
if 'import ' + package + '.RenderExportPlugin;' not in text:
    text = text.replace(match.group(0), match.group(0) + '\n\nimport ' + package + '.RenderExportPlugin;')
if 'registerPlugin(RenderExportPlugin.class)' not in text:
    on_create = re.search(r'(protected|public)\s+void\s+onCreate\s*\([^)]*\)\s*\{', text)
    if not on_create:
        raise SystemExit('Could not find MainActivity.onCreate to register RenderExport')
    pos = on_create.end()
    text = text[:pos] + '\n        registerPlugin(RenderExportPlugin.class);' + text[pos:]
main.write_text(text)
print(f'Added native SAF RenderExport plugin and registered it in {main}')
