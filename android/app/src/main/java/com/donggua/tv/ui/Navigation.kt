package com.donggua.tv.ui

import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.donggua.tv.AppPrefs
import com.donggua.tv.AppSession
import com.donggua.tv.DongguaApi

@Composable
fun MainNavigation(
    api: DongguaApi,
    prefs: AppPrefs,
    appName: String,
    onServerChanged: (String) -> Unit
) {
    val nav = rememberNavController()
    val session = remember { AppSession() }

    fun openSearch(keyword: String) {
        nav.navigate("search?q=${Uri.encode(keyword)}")
    }

    NavHost(navController = nav, startDestination = "home") {
        composable("home") {
            HomeScreen(
                api = api,
                appName = appName,
                onSearch = { openSearch(it) },
                onSettings = { nav.navigate("settings") },
                onOpenTmdb = { item ->
                    session.selectedTmdb = item
                    nav.navigate("tmdb")
                }
            )
        }
        composable(
            route = "search?q={q}",
            arguments = listOf(navArgument("q") { type = NavType.StringType; defaultValue = "" })
        ) { entry ->
            val query = entry.arguments?.getString("q").orEmpty()
            SearchScreen(
                api = api,
                initialQuery = query,
                onBack = { nav.popBackStack() },
                onSettings = { nav.navigate("settings") },
                onOpenTmdb = { item ->
                    session.selectedTmdb = item
                    nav.navigate("tmdb")
                },
                onOpenGroup = { group ->
                    session.selectedGroup = group
                    nav.navigate("detail")
                }
            )
        }
        composable("detail") {
            DetailScreen(
                api = api,
                session = session,
                onBack = { nav.popBackStack() },
                onPlay = { episodes, index, title ->
                    session.playingEpisodes = episodes
                    session.playingIndex = index
                    session.playingTitle = title
                    nav.navigate("player")
                }
            )
        }
        composable("tmdb") {
            TmdbDetailScreen(
                api = api,
                session = session,
                onBack = { nav.popBackStack() },
                onSearchSources = { title -> openSearch(title) }
            )
        }
        composable("player") {
            PlayerScreen(
                session = session,
                onBack = { nav.popBackStack() }
            )
        }
        composable("settings") {
            SettingsScreen(
                api = api,
                prefs = prefs,
                appName = appName,
                onBack = { nav.popBackStack() },
                onServerChanged = onServerChanged
            )
        }
    }
}
