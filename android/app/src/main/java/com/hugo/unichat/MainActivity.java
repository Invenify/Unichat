package com.hugo.unichat;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Enregistrer le plugin natif AVANT l'initialisation du pont Capacitor.
        registerPlugin(UniChatWebViews.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onBackPressed() {
        // Retour système : d'abord l'historique de la WebView du service
        // ouverte, sinon fermer la vue ; le reste remonte au pont.
        if (UniChatWebViews.handleSystemBack()) return;
        super.onBackPressed();
    }
}
