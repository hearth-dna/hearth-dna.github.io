package com.hearth

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.hearth.ui.HearthApp
import com.hearth.ui.HearthTheme

/**
 * The native app's entry point while it is built screen by screen beside the web view (ADR 0010,
 * "Staging"). Debug builds only, under its own launcher icon; at parity this becomes the launcher
 * activity in main/ and MainActivity goes.
 */
class NativeActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent { HearthTheme { HearthApp() } }
    }
}
