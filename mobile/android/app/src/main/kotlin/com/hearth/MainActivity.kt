package com.hearth

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.hearth.ui.HearthApp
import com.hearth.ui.HearthTheme

/**
 * The app (ADR 0010): one activity, drawn edge to edge with Compose. Everything else starts in
 * [HearthApp]; this only owns what must belong to an activity, the cloud sign-in's result launchers
 * and the browser coming back from a Dropbox sign-in.
 */
class MainActivity : ComponentActivity() {
    /** Cloud sign-in registers its result launchers, so it is made in onCreate, before anything starts. */
    private lateinit var cloud: Cloud

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        cloud = Cloud(this)
        intent?.data?.let(cloud::onRedirect)
        setContent { HearthTheme { HearthApp(cloud) } }
    }

    /** The browser coming back from a Dropbox sign-in, through the `db-<app key>` scheme. */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.data?.let(cloud::onRedirect)
    }

    override fun onResume() {
        super.onResume()
        cloud.onResume()
    }
}
