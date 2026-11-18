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
import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaFormat;
import android.media.MediaMuxer;
import android.media.MediaCodecList;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.util.Arrays;

@CapacitorPlugin(name = "RenderExport")
public class RenderExportPlugin extends Plugin {{
  private static final String PREFS = "editor3d_render_export";
  private static final String TREE_KEY = "tree_uri";
  private static final String PROJECT_TREE_KEY = "project_tree_uri";
  private MediaCodec videoEncoder; private MediaMuxer videoMuxer; private File videoTemp; private int videoFrame, videoWidth, videoHeight, videoFps; private int videoTrack = -1; private int videoColorFormat; private boolean videoMuxerStarted = false;

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
  public void chooseProjectFolder(PluginCall call) {{
    Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
    startActivityForResult(call, intent, "projectFolderPicked");
  }}

  @ActivityCallback
  private void projectFolderPicked(PluginCall call, ActivityResult result) {{
    if (call == null) return;
    if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {{ call.reject("canceled"); return; }}
    Uri tree = result.getData().getData();
    int flags = result.getData().getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
    try {{ getContext().getContentResolver().takePersistableUriPermission(tree, flags); }} catch (Exception e) {{ call.reject("Could not keep project folder permission: " + e.getMessage()); return; }}
    getContext().getSharedPreferences(PREFS, 0).edit().putString(PROJECT_TREE_KEY, tree.toString()).apply();
    JSObject ret = new JSObject(); ret.put("displayName", queryName(tree)); call.resolve(ret);
  }}

  @PluginMethod
  public void getProjectFolder(PluginCall call) {{
    String value = getContext().getSharedPreferences(PREFS, 0).getString(PROJECT_TREE_KEY, null);
    JSObject ret = new JSObject(); ret.put("displayName", value == null ? "" : queryName(Uri.parse(value))); call.resolve(ret);
  }}

  @PluginMethod
  public void readProjectFile(PluginCall call) {{
    Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
    intent.addCategory(Intent.CATEGORY_OPENABLE); intent.setType("application/json");
    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
    startActivityForResult(call, intent, "projectFilePicked");
  }}

  @ActivityCallback
  private void projectFilePicked(PluginCall call, ActivityResult result) {{
    if (call == null) return;
    if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {{ call.reject("canceled"); return; }}
    Uri uri=result.getData().getData();
    try {{
      int flags=result.getData().getFlags() & Intent.FLAG_GRANT_READ_URI_PERMISSION;
      try {{ getContext().getContentResolver().takePersistableUriPermission(uri,flags); }} catch(Exception ignored) {{}}
      ByteArrayOutputStream bytes=new ByteArrayOutputStream();
      try(InputStream input=getContext().getContentResolver().openInputStream(uri)) {{ if(input==null)throw new IllegalStateException("Could not open project file");byte[] buffer=new byte[65536];int count;while((count=input.read(buffer))!=-1)bytes.write(buffer,0,count); }}
      JSObject ret=new JSObject();ret.put("name",queryName(uri));ret.put("data",Base64.encodeToString(bytes.toByteArray(),Base64.NO_WRAP));call.resolve(ret);
    }} catch(Exception e) {{ call.reject("Could not read project file: "+e.getMessage(),e); }}
  }}

  @PluginMethod
  public void saveProjectFile(PluginCall call) {{
    String name = call.getString("name"); String mime = call.getString("mimeType", "application/json"); String encoded = call.getString("data");
    if (name == null || encoded == null) {{ call.reject("Missing project file name or data"); return; }}
    String value = getContext().getSharedPreferences(PREFS, 0).getString(PROJECT_TREE_KEY, null);
    if (value == null) {{ call.reject("Choose Documents for project backup first"); return; }}
    try {{
      Uri tree = Uri.parse(value);
      Uri parent = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
      String safe = name.replaceAll("[^A-Za-z0-9._-]", "_");
      String parentId = DocumentsContract.getTreeDocumentId(tree);
      Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parentId);
      try (Cursor cursor = getContext().getContentResolver().query(children, new String[]{{DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME}}, null, null, null)) {{
        if (cursor != null) while (cursor.moveToNext()) if (safe.equals(cursor.getString(1))) {{
          Uri old = DocumentsContract.buildDocumentUriUsingTree(tree, cursor.getString(0));
          DocumentsContract.deleteDocument(getContext().getContentResolver(), old); break;
        }}
      }}
      Uri file = DocumentsContract.createDocument(getContext().getContentResolver(), parent, mime, safe);
      if (file == null) throw new IllegalStateException("Android could not create project file");
      byte[] bytes = Base64.decode(encoded, Base64.DEFAULT);
      try (OutputStream output = getContext().getContentResolver().openOutputStream(file, "w")) {{ if (output == null) throw new IllegalStateException("Android could not open project file"); output.write(bytes); output.flush(); }}
      JSObject ret = new JSObject(); ret.put("name", safe); ret.put("uri", file.toString()); call.resolve(ret);
    }} catch (Exception e) {{ call.reject("Could not save project file: " + e.getMessage(), e); }}
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

  @PluginMethod
  public void startVideo(PluginCall call) {{
    try {{
      videoWidth=call.getInt("width",1280); videoHeight=call.getInt("height",720); videoFps=call.getInt("fps",24);
      if ((videoWidth&1)!=0 || (videoHeight&1)!=0) throw new IllegalArgumentException("MP4 width/height must be even");
      videoFrame=0; videoTrack=-1; videoMuxerStarted=false;
      videoTemp=new File(getContext().getCacheDir(),"editor-render-"+System.currentTimeMillis()+".mp4");
      videoMuxer=new MediaMuxer(videoTemp.getAbsolutePath(),MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
      MediaFormat fmt=MediaFormat.createVideoFormat("video/avc",videoWidth,videoHeight);
      videoColorFormat=chooseYuvColorFormat(); fmt.setInteger(MediaFormat.KEY_COLOR_FORMAT,videoColorFormat);
      fmt.setInteger(MediaFormat.KEY_BIT_RATE,Math.min(18000000,Math.max(2000000,videoWidth*videoHeight*5)));
      fmt.setInteger(MediaFormat.KEY_FRAME_RATE,videoFps); fmt.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL,2);
      videoEncoder=MediaCodec.createEncoderByType("video/avc"); videoEncoder.configure(fmt,null,null,MediaCodec.CONFIGURE_FLAG_ENCODE); videoEncoder.start(); call.resolve();
    }} catch(Exception e) {{ cleanupVideo(); call.reject("No se pudo iniciar codificador MP4: "+e.getMessage(),e); }}
  }}
  @PluginMethod
  public void addVideoFrame(PluginCall call) {{
    try {{
      if(videoEncoder==null) throw new IllegalStateException("MP4 no iniciado");
      byte[] jpg=Base64.decode(call.getString("jpeg"),Base64.DEFAULT); Bitmap bmp=BitmapFactory.decodeByteArray(jpg,0,jpg.length);
      if(bmp==null) throw new IllegalArgumentException("Imagen de cuadro inválida");
      Bitmap scaled=(bmp.getWidth()==videoWidth&&bmp.getHeight()==videoHeight)?bmp:Bitmap.createScaledBitmap(bmp,videoWidth,videoHeight,true);
      int[] pixels=new int[videoWidth*videoHeight]; scaled.getPixels(pixels,0,videoWidth,0,0,videoWidth,videoHeight);
      if(scaled!=bmp) scaled.recycle(); bmp.recycle(); byte[] yuv=argbToYuv420(pixels,videoWidth,videoHeight,videoColorFormat); Arrays.fill(pixels,0);
      int input=videoEncoder.dequeueInputBuffer(10000); if(input<0) throw new IllegalStateException("Codificador H.264 ocupado");
      ByteBuffer in=videoEncoder.getInputBuffer(input); if(in==null||in.capacity()<yuv.length) throw new IllegalStateException("Buffer de video insuficiente");
      in.clear(); in.put(yuv); videoEncoder.queueInputBuffer(input,0,yuv.length,(long)videoFrame*1000000L/videoFps,0); videoFrame++; drainVideo(false); call.resolve();
    }} catch(Exception e) {{ call.reject("Error al codificar cuadro MP4: "+e.getMessage(),e); }}
  }}
  @PluginMethod
  public void finishVideo(PluginCall call) {{
    try {{
      if(videoEncoder==null) throw new IllegalStateException("MP4 no iniciado");
      int input=videoEncoder.dequeueInputBuffer(10000); if(input<0) throw new IllegalStateException("No se pudo cerrar el video");
      videoEncoder.queueInputBuffer(input,0,0,(long)videoFrame*1000000L/videoFps,MediaCodec.BUFFER_FLAG_END_OF_STREAM); drainVideo(true);
      videoEncoder.stop(); videoEncoder.release(); videoEncoder=null; videoMuxer.stop(); videoMuxer.release(); videoMuxer=null;
      String value=getContext().getSharedPreferences(PREFS,0).getString(TREE_KEY,null); if(value==null) throw new IllegalStateException("Elige una carpeta de exportación primero");
      Uri tree=Uri.parse(value); Uri parent=DocumentsContract.buildDocumentUriUsingTree(tree,DocumentsContract.getTreeDocumentId(tree));
      Uri dst=DocumentsContract.createDocument(getContext().getContentResolver(),parent,"video/mp4","render-"+System.currentTimeMillis()+".mp4"); if(dst==null) throw new IllegalStateException("No se pudo crear archivo MP4");
      try(FileInputStream in=new FileInputStream(videoTemp); OutputStream out=getContext().getContentResolver().openOutputStream(dst,"w")) {{ if(out==null) throw new IllegalStateException("No se pudo abrir archivo destino"); byte[] b=new byte[65536]; int n; while((n=in.read(b))!=-1) out.write(b,0,n); out.flush(); }}
      JSObject ret=new JSObject(); ret.put("uri",dst.toString()); ret.put("frames",videoFrame); call.resolve(ret); cleanupVideo();
    }} catch(Exception e) {{ cleanupVideo(); call.reject("Falló exportación MP4: "+e.getMessage(),e); }}
  }}
  private void drainVideo(boolean eos) {{
    MediaCodec.BufferInfo info=new MediaCodec.BufferInfo(); int empty=0;
    while(true) {{ int out=videoEncoder.dequeueOutputBuffer(info,eos?10000:0);
      if(out==MediaCodec.INFO_TRY_AGAIN_LATER) {{ if(!eos||++empty>10) break; continue; }}
      if(out==MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {{ if(videoMuxerStarted) throw new IllegalStateException("Encoder format changed twice"); videoTrack=videoMuxer.addTrack(videoEncoder.getOutputFormat()); videoMuxer.start(); videoMuxerStarted=true; continue; }}
      if(out>=0) {{ ByteBuffer buf=videoEncoder.getOutputBuffer(out); if(buf!=null&&info.size>0&&videoMuxerStarted) {{ buf.position(info.offset);buf.limit(info.offset+info.size);videoMuxer.writeSampleData(videoTrack,buf,info); }} boolean done=(info.flags&MediaCodec.BUFFER_FLAG_END_OF_STREAM)!=0; videoEncoder.releaseOutputBuffer(out,false);if(done)break; }}
    }}
  }}
  private int chooseYuvColorFormat() {{
    int planar=MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Planar, semi=MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420SemiPlanar;
    for(MediaCodecInfo info:new MediaCodecList(MediaCodecList.REGULAR_CODECS).getCodecInfos()) {{ if(!info.isEncoder()) continue; for(String type:info.getSupportedTypes()) if(type.equalsIgnoreCase("video/avc")) {{ for(int color:info.getCapabilitiesForType(type).colorFormats) if(color==semi) return semi; for(int color:info.getCapabilitiesForType(type).colorFormats) if(color==planar) return planar; }} }}
    throw new IllegalStateException("Este Android no ofrece un codificador H.264 con entrada YUV420");
  }}
  private byte[] argbToYuv420(int[] p,int w,int h,int colorFormat) {{ int ySize=w*h,u=ySize,v=ySize+ySize/4; boolean semi=(colorFormat==MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420SemiPlanar); byte[] out=new byte[ySize+ySize/2]; for(int row=0;row<h;row++)for(int col=0;col<w;col++){{int c=p[row*w+col],r=(c>>16)&255,g=(c>>8)&255,b=c&255;out[row*w+col]=(byte)Math.max(0,Math.min(255,((66*r+129*g+25*b+128)>>8)+16));if((row&1)==0&&(col&1)==0){{byte ub=(byte)Math.max(0,Math.min(255,((-38*r-74*g+112*b+128)>>8)+128));byte vb=(byte)Math.max(0,Math.min(255,((112*r-94*g-18*b+128)>>8)+128));if(semi){{out[u++]=ub;out[u++]=vb;}}else{{out[u++]=ub;out[v++]=vb;}}}}}}return out; }}
  private void cleanupVideo() {{ try{{if(videoEncoder!=null){{videoEncoder.stop();videoEncoder.release();}}}}catch(Exception ignored){{}} try{{if(videoMuxer!=null){{videoMuxer.stop();videoMuxer.release();}}}}catch(Exception ignored){{}} if(videoTemp!=null)videoTemp.delete();videoEncoder=null;videoMuxer=null;videoTemp=null;videoMuxerStarted=false; }}

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
for import_line in ['import android.os.Bundle;', 'import android.view.View;', 'import android.os.Build;']:
    if import_line not in text:
        text = text.replace(match.group(0), match.group(0) + '\n' + import_line)
activity_class = re.search(r'(public\s+class\s+MainActivity\s+extends\s+BridgeActivity\s*\{)', text)
if not activity_class: raise SystemExit('Could not find MainActivity class')
if 'registerPlugin(RenderExportPlugin.class)' not in text:
    on_create = re.search(r'(protected|public)\s+void\s+onCreate\s*\([^)]*\)\s*\{', text)
    if on_create:
        text = text[:on_create.end()] + '\n        registerPlugin(RenderExportPlugin.class);' + text[on_create.end():]
    else:
        pos = activity_class.end()
        text = text[:pos] + '\n    @Override\n    public void onCreate(Bundle savedInstanceState) {\n        registerPlugin(RenderExportPlugin.class);\n        super.onCreate(savedInstanceState);\n    }\n' + text[pos:]
# Always enforce immersive fullscreen on launch and when the app returns to focus.
if 'private void enableImmersiveMode()' not in text:
    on_create = re.search(r'(public\s+void\s+onCreate\s*\([^)]*\)\s*\{)', text)
    if not on_create: raise SystemExit('MainActivity.onCreate missing')
    close = text.find('\n    }', on_create.end())
    if close < 0: raise SystemExit('Could not find onCreate end')
    text = text[:close] + '\n        enableImmersiveMode();' + text[close:]
    methods = '''
    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) enableImmersiveMode();
    }
    private void enableImmersiveMode() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_FULLSCREEN);
        } else {
            android.view.WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                controller.hide(android.view.WindowInsets.Type.statusBars() | android.view.WindowInsets.Type.navigationBars());
                controller.setSystemBarsBehavior(android.view.WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        }
    }
'''
    class_end = text.rfind('}')
    text = text[:class_end] + methods + text[class_end:]
main.write_text(text)
print(f'Added native SAF PNG/MP4 exporter, immersive mode and registered it in {main}')
