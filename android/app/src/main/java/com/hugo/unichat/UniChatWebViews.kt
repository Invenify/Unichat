package com.hugo.unichat

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebStorage
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.coordinatorlayout.widget.CoordinatorLayout
import androidx.webkit.WebSettingsCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONObject
import java.util.regex.Pattern

private const val POLL_MS = 1500L

/**
 * UniChatWebViews — une WebView Android par service IA, positionnée par-dessus
 * l'UI Capacitor, exactement sur le rect CSS de #webview-slot (géométrie
 * transmise par le JS : x/y/w/h en px CSS × densité).
 *
 * Contrat JS (mobile/webviews.js) :
 *  - open({ id, url, blockNav?, x, y, w, h }) : crée/réutilise la vue, l'affiche,
 *    charge l'URL (pas de rechargement si déjà dessus).
 *  - position({ x, y, w, h }) : recadre la vue active (clavier, rotation).
 *  - hide()/show() : masque la vue quand un bottom-sheet s'ouvre au-dessus
 *    (une vue native couvre toujours le DOM, contrairement au z-index CSS).
 *  - close() : masque (la vue et sa session restent en vie en arrière-plan).
 *  - clearSession({ url }) : cookies + stockage du domaine (« Déconnecter »).
 *  - destroy({ id }) : supprime la vue d'un service (suppression du service).
 *  - events : "page" { id, url, title } → api.recordNavigation ;
 *    "closed" quand le retour système ferme la vue.
 *
 * Au-delà d'onReceivedTitle/onPageFinished, un léger poll (evaluateJavascript,
 * 1,5 s) relaie url+titre : les SPA qui changent de chat par pushState ne
 * déclenchent aucun événement de navigation sur WebView.
 */
@CapacitorPlugin(name = "UniChatWebViews")
class UniChatWebViews : Plugin() {

    companion object {
        @Volatile
        private var current: UniChatWebViews? = null

        // Retour système : d'abord l'historique de la page, sinon fermer la vue.
        // Retourne false si aucune vue n'est ouverte (comportement Capacitor).
        @JvmStatic
        fun handleSystemBack(): Boolean = current?.systemBack() ?: false
    }

    private val main = Handler(Looper.getMainLooper())
    private val views = HashMap<String, WebView>()
    private val blockNav = HashMap<String, Pattern>()
    private val lastState = HashMap<String, String>() // id → "url|titre" déjà émis

    private var activeId: String? = null
    private var cssRect: CssRect? = null
    private var polling = false

    private data class CssRect(val x: Double, val y: Double, val w: Double, val h: Double)

    private val density: Float
        get() = context.resources.displayMetrics.density

    override fun load() {
        super.load()
        current = this
        main.post {
            // La WebView Capacitor est repositionnée (clavier, insets, rotation)
            // → recaler la vue native à chaque passage de layout.
            bridge?.webView?.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ ->
                applyGeometry()
            }
        }
    }

    override fun handleOnDestroy() {
        current = null
        stopPolling()
        for (wv in views.values) {
            (wv.parent as? ViewGroup)?.removeView(wv)
            wv.destroy()
        }
        views.clear()
        blockNav.clear()
        lastState.clear()
        activeId = null
        super.handleOnDestroy()
    }

    // --- Méthodes exposées au JS ---

    @PluginMethod
    fun open(call: PluginCall) {
        val id = call.getString("id")
        val url = call.getString("url")
        if (id == null || url == null) return call.reject("id et url requis")
        val x = call.getDouble("x") ?: 0.0
        val y = call.getDouble("y") ?: 0.0
        val w = call.getDouble("w") ?: 0.0
        val h = call.getDouble("h") ?: 0.0
        call.getString("blockNav")?.let {
            runCatching { Pattern.compile(it) }.getOrNull()?.let { re -> blockNav[id] = re }
        }
        main.post {
            val parent = bridge?.webView?.parent as? ViewGroup
                ?: return@post call.reject("conteneur WebView introuvable")
            val wv = views.getOrPut(id) { buildWebView(id, parent) }
            views[activeId.takeIf { it != id }]?.let { prev ->
                prev.visibility = View.GONE
                prev.onPause()
            }
            activeId = id
            cssRect = CssRect(x, y, w, h)
            applyGeometry()
            wv.visibility = View.VISIBLE
            wv.onResume()
            wv.bringToFront()
            if (wv.url != url) wv.loadUrl(url)
            startPolling()
            call.resolve()
        }
    }

    @PluginMethod
    fun position(call: PluginCall) {
        cssRect = CssRect(
            call.getDouble("x") ?: 0.0,
            call.getDouble("y") ?: 0.0,
            call.getDouble("w") ?: 0.0,
            call.getDouble("h") ?: 0.0
        )
        main.post {
            applyGeometry()
            call.resolve()
        }
    }

    @PluginMethod
    fun hide(call: PluginCall) {
        main.post {
            views[activeId]?.let { it.visibility = View.GONE; it.onPause() }
            stopPolling()
            call.resolve()
        }
    }

    @PluginMethod
    fun show(call: PluginCall) {
        main.post {
            views[activeId]?.let { it.visibility = View.VISIBLE; it.onResume(); it.bringToFront() }
            startPolling()
            call.resolve()
        }
    }

    @PluginMethod
    fun close(call: PluginCall) {
        main.post {
            views[activeId]?.let { it.visibility = View.GONE; it.onPause() }
            activeId = null
            stopPolling()
            call.resolve()
        }
    }

    /** « Déconnecter » : expire les cookies du domaine et vide son stockage
     *  web (localStorage/indexedDB du service). */
    @PluginMethod
    fun clearSession(call: PluginCall) {
        val url = call.getString("url") ?: return call.reject("url requise")
        main.post {
            val host = runCatching { Uri.parse(url).host }.getOrNull()
            if (host != null && host.isNotEmpty()) {
                val cm = CookieManager.getInstance()
                for (base in listOf("https://$host", "https://www.$host")) {
                    val raw = cm.getCookie(base) ?: continue
                    for (pair in raw.split(";")) {
                        val name = pair.substringBefore('=').trim()
                        if (name.isEmpty()) continue
                        // Expiration des deux variantes (cookie hôte et .domaine).
                        cm.setCookie(base, "$name=; Max-Age=0; Path=/")
                        cm.setCookie(base, "$name=; Max-Age=0; Path=/; Domain=.$host")
                    }
                }
                cm.flush()
                for (origin in listOf("https://$host", "https://www.$host")) {
                    runCatching { WebStorage.getInstance().deleteOrigin(origin) }
                }
            }
            call.resolve()
        }
    }

    @PluginMethod
    fun destroy(call: PluginCall) {
        val id = call.getString("id") ?: return call.reject("id requis")
        main.post {
            views.remove(id)?.let { wv ->
                (wv.parent as? ViewGroup)?.removeView(wv)
                wv.destroy()
            }
            blockNav.remove(id)
            lastState.remove(id)
            if (activeId == id) {
                activeId = null
                stopPolling()
            }
            call.resolve()
        }
    }

    // --- Retour système (onBackPressed → MainActivity) ---

    fun systemBack(): Boolean {
        val id = activeId ?: return false
        val wv = views[id]
        if (wv == null) {
            activeId = null
            return false
        }
        if (wv.canGoBack()) {
            wv.goBack()
            return true
        }
        wv.visibility = View.GONE
        wv.onPause()
        activeId = null
        stopPolling()
        notifyListeners("closed", JSObject())
        return true
    }

    // --- Internes ---

    @SuppressLint("SetJavaScriptEnabled")
    private fun buildWebView(id: String, parent: ViewGroup): WebView {
        val wv = WebView(context)
        wv.tag = id
        wv.settings.javaScriptEnabled = true
        wv.settings.domStorageEnabled = true
        wv.settings.mediaPlaybackRequiresUserGesture = false
        // Thème sombre de l'OS : assombrissement algorithmique du WebView
        // (best effort, jamais de crash si non disponible).
        runCatching { WebSettingsCompat.setAlgorithmicDarkeningAllowed(wv.settings, true) }
        // Certains services filtrent les WebView : on gomme le marqueur « wv ».
        wv.settings.userAgentString = wv.settings.userAgentString.replace("; wv", "")
        CookieManager.getInstance().setAcceptThirdPartyCookies(wv, true)
        wv.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val uri = request.url
                val scheme = uri.scheme?.lowercase() ?: return false
                if (scheme != "http" && scheme != "https") {
                    // Schémas externes (mailto:, intent:, market:…) → app adaptée.
                    runCatching { bridge?.activity?.startActivity(Intent(Intent.ACTION_VIEW, uri)) }
                    return true
                }
                val key = view.tag as? String ?: return false
                return blockNav[key]?.matcher(uri.toString())?.find() == true
            }

            override fun onPageFinished(view: WebView, url: String?) {
                emit(view, view.url, view.title)
            }
        }
        wv.webChromeClient = object : WebChromeClient() {
            override fun onReceivedTitle(view: WebView, title: String?) {
                emit(view, view.url, title)
            }
        }
        parent.addView(wv, makeLayoutParams(parent, 0, 0))
        return wv
    }

    // Le conteneur du pont Capacitor 8 est un CoordinatorLayout (pas un
    // FrameLayout) : ses enfants EXIGENT ses LayoutParams, sinon crash à la
    // passe de layout suivante. On génère le bon type selon le parent réel.
    private fun makeLayoutParams(parent: ViewGroup, w: Int, h: Int): ViewGroup.LayoutParams {
        return when (parent) {
            is CoordinatorLayout -> CoordinatorLayout.LayoutParams(w, h)
            is FrameLayout -> FrameLayout.LayoutParams(w, h)
            else -> ViewGroup.MarginLayoutParams(w, h)
        }
    }

    private fun applyGeometry() {
        val id = activeId ?: return
        val wv = views[id] ?: return
        val rect = cssRect ?: return
        val cap = bridge?.webView ?: return
        val parent = wv.parent as? ViewGroup ?: return
        val lp = makeLayoutParams(
            parent,
            (rect.w * density).toInt().coerceAtLeast(0),
            (rect.h * density).toInt().coerceAtLeast(0)
        )
        if (lp is ViewGroup.MarginLayoutParams) {
            lp.leftMargin = cap.left + (rect.x * density).toInt()
            lp.topMargin = cap.top + (rect.y * density).toInt()
        }
        wv.layoutParams = lp
        wv.requestLayout()
    }

    private fun emit(view: WebView, url: String?, title: String?) {
        val key = view.tag as? String ?: return
        if (url != null) emitState(key, url, title ?: return)
    }

    private fun emitState(id: String, url: String, title: String) {
        if (!url.startsWith("http")) return
        val t = title.trim()
        if (t.isEmpty()) return
        val state = "$url|$t"
        if (lastState[id] == state) return
        lastState[id] = state
        val data = JSObject()
        data.put("id", id)
        data.put("url", url)
        data.put("title", t)
        notifyListeners("page", data)
    }

    // Poll url+titre : les SPA changent de conversation par pushState, sans
    // aucun événement de navigation côté WebView.
    private val pollTick = object : Runnable {
        override fun run() {
            if (!polling) return
            val id = activeId
            if (id == null) {
                stopPolling()
                return
            }
            val wv = views[id]
            if (wv != null) {
                wv.evaluateJavascript(
                    "(function(){try{return JSON.stringify({u:location.href,t:document.title})}catch(e){return null}})()"
                ) { s ->
                    if (s != null && s != "null") {
                        runCatching {
                            val o = JSONObject(s)
                            emitState(id, o.optString("u"), o.optString("t"))
                        }
                    }
                }
            }
            main.postDelayed(this, POLL_MS)
        }
    }

    private fun startPolling() {
        if (polling) return
        polling = true
        main.postDelayed(pollTick, POLL_MS)
    }

    private fun stopPolling() {
        polling = false
        main.removeCallbacks(pollTick)
    }
}
