// import React, { useState } from 'react';
// import {
//   View,
//   Text,
//   TextInput,
//   Button,
//   StyleSheet,
//   Image,
//   ActivityIndicator,
//   ScrollView,
//   SafeAreaView,
//   Platform,
//   Alert
// } from 'react-native';
// import * as FileSystem from 'expo-file-system'; // For file system operations
// import * as MediaLibrary from 'expo-media-library'; // For saving to media library and permissions

// // !!! IMPORTANT: Replace YOUR_COMPUTER_IP_ADDRESS with your actual local IP address.
// const BACKEND_URL = 'http://192.168.100.118:3000'; // Node.js backend typically on port 3000


// const App = () => {
//   const [videoUrl, setVideoUrl] = useState('');
//   const [videoInfo, setVideoInfo] = useState(null);
//   const [isLoading, setIsLoading] = useState(false);
//   const [errorMessage, setErrorMessage] = useState('');
//   const [downloadProgress, setDownloadProgress] = useState(0);

//   /**
//    * handleGetVideoInfo
//    * Fetches video information from the backend.
//    */
//   const handleGetVideoInfo = async () => {
//     setErrorMessage('');
//     setVideoInfo(null);
//     setDownloadProgress(0); // Reset progress
//     if (!videoUrl) {
//       setErrorMessage('Please enter a YouTube video URL.');
//       return;
//     }

//     setIsLoading(true);
//     try {
//       console.log(`Fetching video info from: ${BACKEND_URL}/get-video-info for URL: ${videoUrl}`);
//       const response = await fetch(`${BACKEND_URL}/get-video-info`, {
//         method: 'POST',
//         headers: {
//           'Content-Type': 'application/json',
//         },
//         body: JSON.stringify({ url: videoUrl }),
//       });

//       const data = await response.json();
//       console.log('Backend response for info:', data);

//       if (!response.ok) {
//         setErrorMessage(data.error || 'Failed to fetch video information. Please check the URL.');
//         return;
//       }

//       setVideoInfo(data);

//     } catch (error) {
//       console.error('Error fetching video info:', error);
//       setErrorMessage(`Network error: Could not connect to backend. Is it running at ${BACKEND_URL}? Error: ${error.message}`);
//     } finally {
//       setIsLoading(false);
//     }
//   };

//   /**
//    * handleDownloadVideo
//    * Initiates video download from the backend and saves it locally using Expo FileSystem.
//    * Now uses GET request with query parameters for robustness.
//    */
//   const handleDownloadVideo = async (quality) => {
//     setErrorMessage('');
//     if (!videoInfo) {
//       setErrorMessage('Please get video info first.');
//       return;
//     }

//     // 1. Request Media Library Permissions (Android & iOS)
//     const { status } = await MediaLibrary.requestPermissionsAsync();
//     if (status !== 'granted') {
//       setErrorMessage('Permission to access media library is required to save videos.');
//       Alert.alert(
//         'Permission Denied',
//         'Please grant media library access in your device settings to download videos.',
//         [{ text: 'OK' }]
//       );
//       return;
//     }

//     setIsLoading(true);
//     setDownloadProgress(0); // Reset progress

//     try {
//       // Sanitize title for filename safety
//       const sanitizedTitle = videoInfo.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
//       const filename = `${sanitizedTitle}_${quality}.mp4`; // Assuming MP4 output from backend
//       const downloadDest = FileSystem.documentDirectory + filename;

//       // --- CRITICAL CHANGE HERE: Construct URL with query parameters for GET request ---
//       const downloadUrl = `${BACKEND_URL}/download-video?url=${encodeURIComponent(videoUrl)}&quality=${encodeURIComponent(quality)}`;
//       console.log(`Attempting to download to: ${downloadDest}`);
//       console.log(`Calling backend download: ${downloadUrl}`);

//       const downloadResumable = FileSystem.createDownloadResumable(
//         downloadUrl, // Use the URL with query parameters
//         downloadDest,
//         // Remove method and body options as it's now a GET request via URL
//         // { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: videoUrl, quality: quality }), }
//       );

//       // Use the 'callback' property directly for download progress
//       downloadResumable.callback = downloadProgress => {
//         const progress = downloadProgress.totalBytesExpectedToWrite > 0
//           ? downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite
//           : 0;
//         setDownloadProgress(Math.round(progress * 100));
//         console.log(`Download progress: ${Math.round(progress * 100)}%`);
//       };

//       // Start the download
//       const { uri, status: downloadStatus, headers } = await downloadResumable.downloadAsync();
//       console.log('Download complete status:', downloadStatus);
//       console.log('Downloaded file URI:', uri);
//       console.log('Download headers from backend:', headers);


//       if (downloadStatus !== 200) {
//         setErrorMessage(`Download failed with status: ${downloadStatus}. Check backend logs.`);
//         console.error('Download error headers:', headers);
//         try {
//             const errorText = await FileSystem.readAsStringAsync(uri);
//             console.error('Backend error response (partial):', errorText);
//             setErrorMessage(`Download failed: ${errorText.substring(0, Math.min(errorText.length, 200))}... (See console for full error)`);
//         } catch (readError) {
//             console.warn('Could not read error response from download:', readError);
//         }
//         await FileSystem.deleteAsync(uri, { idempotent: true });
//         return;
//       }

//       console.log('Finished downloading to:', uri);
//       // 3. Save the downloaded file to the device's media library
//       const asset = await MediaLibrary.createAssetAsync(uri);
//       console.log('Asset created:', asset);

//       // Optional: Create an album to organize downloads
//       const albumName = 'YouTubeDownloader';
//       const album = await MediaLibrary.getAlbumAsync(albumName);
//       if (album == null) {
//         await MediaLibrary.createAlbumAsync(albumName, asset, false);
//         console.log('Album created and asset added.');
//       } else {
//         await MediaLibrary.addAssetsToAlbumAsync([asset], album.id, false);
//         console.log('Asset added to existing album.');
//       }

//       setErrorMessage(`Video "${videoInfo.title}" downloaded and saved successfully!`);
//       setVideoInfo(null);
//       setVideoUrl('');
//       setDownloadProgress(0);

//     } catch (error) {
//       console.error('Error during download:', error);
//       setErrorMessage(`Download failed: ${error.message}. Please check network connection and backend.`);
//       if (error.message.includes("Could not connect to the server") || error.message.includes("Network request failed")) {
//           setErrorMessage(`Network error during download. Is the backend running at ${BACKEND_URL} and accessible from your phone?`);
//       }
//     } finally {
//       setIsLoading(false);
//     }
//   };
//   return (
//     <SafeAreaView style={styles.safeArea}>
//       <ScrollView contentContainerStyle={styles.container}>
//         <Text style={styles.headerText}>
//           YouTube Video Downloader
//         </Text>

//         <View style={styles.inputCard}>
//           <TextInput
//             style={styles.textInput}
//             placeholder="Enter YouTube Video URL"
//             value={videoUrl}
//             onChangeText={setVideoUrl}
//             keyboardType="url"
//             autoCapitalize="none"
//           />
//           <Button
//             title={isLoading && !videoInfo ? 'Fetching Info...' : 'Get Video Info'}
//             onPress={handleGetVideoInfo}
//             disabled={isLoading}
//             color="#4299E1" // Blue-500
//           />
//         </View>

//         {errorMessage ? (
//           <Text style={styles.errorMessage}>
//             {errorMessage}
//           </Text>
//         ) : null}

//         {isLoading && !videoInfo ? (
//           <View style={styles.loadingContainer}>
//             <ActivityIndicator size="large" color="#4299E1" />
//             <Text style={styles.loadingText}>Fetching video info...</Text>
//           </View>
//         ) : null}

//         {videoInfo && (
//           <View style={styles.videoInfoCard}>
//             <Text style={styles.videoTitle}>
//               {videoInfo.title}
//             </Text>
//             {videoInfo.thumbnail ? (
//               <Image
//                 source={{ uri: videoInfo.thumbnail }}
//                 style={styles.thumbnailImage}
//                 resizeMode="cover"
//               />
//             ) : null}
//             <Text style={styles.videoDetailText}>
//               Duration: {videoInfo.duration}
//             </Text>
//             <Text style={styles.videoDetailText}>
//               Available Qualities: {videoInfo.qualities.join(', ')}
//             </Text>

//             <Text style={styles.chooseQualityText}>
//               Choose Quality to Download:
//             </Text>
//             {videoInfo.qualities.map((quality) => (
//               <View key={quality} style={styles.downloadButtonContainer}>
//                 <Button
//                   title={`Download ${quality}`}
//                   onPress={() => handleDownloadVideo(quality)}
//                   disabled={isLoading}
//                   color="#38A169" // Green-600
//                 />
//               </View>
//             ))}

//             {isLoading && downloadProgress > 0 && (
//                 <View style={styles.downloadProgressContainer}>
//                     <Text style={styles.downloadProgressText}>Downloading: {downloadProgress}%</Text>
//                     {/* You could add a custom progress bar component here */}
//                 </View>
//             )}
//           </View>
//         )}
//       </ScrollView>
//     </SafeAreaView>
//   );
// };

// const styles = StyleSheet.create({
//   safeArea: {
//     flex: 1,
//     backgroundColor: '#F7FAFC', // Tailwind 'gray-100'
//   },
//   container: {
//     flexGrow: 1,
//     alignItems: 'center',
//     padding: 20,
//     backgroundColor: '#F7FAFC', // Tailwind 'gray-100'
//   },
//   headerText: {
//     fontSize: 30,
//     fontWeight: 'bold',
//     marginBottom: 24,
//     textAlign: 'center',
//     color: '#1E40AF', // Tailwind 'blue-800'
//   },
//   inputCard: {
//     width: '100%',
//     marginBottom: 24,
//     padding: 16,
//     backgroundColor: '#FFFFFF',
//     borderRadius: 8,
//     elevation: 4, // Android shadow
//     shadowColor: '#000', // iOS shadow
//     shadowOffset: { width: 0, height: 2 },
//     shadowOpacity: 0.25,
//     shadowRadius: 3.84,
//   },
//   textInput: {
//     borderWidth: 1,
//     borderColor: '#D1D5DB', // Tailwind 'gray-300'
//     padding: 12,
//     marginBottom: 16,
//     borderRadius: 6,
//     fontSize: 16,
//     width: '100%',
//   },
//   errorMessage: {
//     color: '#DC2626', // Tailwind 'red-600'
//     marginBottom: 16,
//     textAlign: 'center',
//     fontSize: 16,
//     fontWeight: '600',
//   },
//   loadingContainer: {
//     marginVertical: 16,
//     alignItems: 'center',
//   },
//   loadingText: {
//     color: '#374151', // Tailwind 'gray-700'
//     marginTop: 8,
//   },
//   videoInfoCard: {
//     width: '100%',
//     backgroundColor: '#FFFFFF',
//     borderRadius: 8,
//     elevation: 4,
//     shadowColor: '#000',
//     shadowOffset: { width: 0, height: 2 },
//     shadowOpacity: 0.25,
//     shadowRadius: 3.84,
//   },
//   videoTitle: {
//     fontSize: 20,
//     fontWeight: '600',
//     marginBottom: 12,
//     color: '#1D4ED8', // Tailwind 'blue-700'
//   },
//   thumbnailImage: {
//     width: '100%',
//     height: 192,
//     borderRadius: 8,
//     marginBottom: 12,
//   },
//   videoDetailText: {
//     color: '#374151', // Tailwind 'gray-700'
//     marginBottom: 8,
//     fontSize: 16,
//   },
//   chooseQualityText: {
//     fontSize: 18,
//     fontWeight: '500',
//     marginBottom: 12,
//     color: '#1F2937', // Tailwind 'gray-800'
//     marginTop: 8,
//   },
//   downloadButtonContainer: {
//     marginBottom: 8,
//   },
//   downloadProgressContainer: {
//     marginTop: 16,
//     alignItems: 'center',
//   },
//   downloadProgressText: {
//     color: '#374151',
//     fontSize: 16,
//   },
// });

// export default App;

import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Button,
  StyleSheet,
  Image,
  ActivityIndicator,
  ScrollView,
  SafeAreaView,
  Platform,
  Alert
} from 'react-native';
import * as FileSystem from 'expo-file-system'; // For file system operations
import * as MediaLibrary from 'expo-media-library'; // For saving to media library and permissions

// !!! IMPORTANT: Replace YOUR_COMPUTER_IP_ADDRESS with your actual local IP address.
const BACKEND_URL = 'http://192.168.100.118:3000'; // Node.js backend typically on port 3000


const App = () => {
  const [videoUrl, setVideoUrl] = useState('');
  const [videoInfo, setVideoInfo] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [downloadProgress, setDownloadProgress] = useState(0);

  /**
   * handleGetVideoInfo
   * Fetches video information from the backend.
   */
  const handleGetVideoInfo = async () => {
    setErrorMessage('');
    setVideoInfo(null);
    setDownloadProgress(0); // Reset progress
    if (!videoUrl) {
      setErrorMessage('Please enter a YouTube video URL.');
      return;
    }

    setIsLoading(true);
    try {
      console.log(`Fetching video info from: ${BACKEND_URL}/get-video-info for URL: ${videoUrl}`);
      const response = await fetch(`${BACKEND_URL}/get-video-info`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: videoUrl }),
      });

      const data = await response.json();
      console.log('Backend response for info:', data);

      if (!response.ok) {
        setErrorMessage(data.error || 'Failed to fetch video information. Please check the URL.');
        return;
      }

      setVideoInfo(data);

    } catch (error) {
      console.error('Error fetching video info:', error);
      setErrorMessage(`Network error: Could not connect to backend. Is it running at ${BACKEND_URL}? Error: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * handleDownloadVideo
   * Initiates video download from the backend and saves it locally using Expo FileSystem.
   * Now uses GET request with query parameters for robustness.
   */
  const handleDownloadVideo = async (quality) => {
    setErrorMessage('');
    if (!videoInfo) {
      setErrorMessage('Please get video info first.');
      return;
    }

    // 1. Request Media Library Permissions (Android & iOS)
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== 'granted') {
      setErrorMessage('Permission to access media library is required to save videos.');
      Alert.alert(
        'Permission Denied',
        'Please grant media library access in your device settings to download videos.',
        [{ text: 'OK' }]
      );
      return;
    }

    setIsLoading(true);
    setDownloadProgress(0); // Reset progress

    try {
      // Sanitize title for filename safety
      const sanitizedTitle = videoInfo.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      const filename = `${sanitizedTitle}_${quality}.mp4`; // Assuming MP4 output from backend
      const downloadDest = FileSystem.documentDirectory + filename;

      // Construct URL with query parameters for GET request
      const downloadUrl = `${BACKEND_URL}/download-video?url=${encodeURIComponent(videoUrl)}&quality=${encodeURIComponent(quality)}`;
      console.log(`Attempting to download to: ${downloadDest}`);
      console.log(`Calling backend download: ${downloadUrl}`);

      const downloadResumable = FileSystem.createDownloadResumable(
        downloadUrl, // Use the URL with query parameters
        downloadDest,
        // No method/headers/body needed for GET request via URL
      );

      // Use the 'callback' property directly for download progress
      downloadResumable.callback = downloadProgress => {
        const progress = downloadProgress.totalBytesExpectedToWrite > 0
          ? downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite
          : 0;
        setDownloadProgress(Math.round(progress * 100));
        console.log(`Download progress: ${Math.round(progress * 100)}%`);
      };

      // Start the download
      const { uri, status: downloadStatus, headers } = await downloadResumable.downloadAsync();
      console.log('Download complete status:', downloadStatus);
      console.log('Downloaded file URI:', uri);
      console.log('Download headers from backend:', headers);


      if (downloadStatus !== 200) {
        setErrorMessage(`Download failed with status: ${downloadStatus}. Check backend logs.`);
        console.error('Download error headers:', headers);
        try {
            const errorText = await FileSystem.readAsStringAsync(uri);
            console.error('Backend error response (partial):', errorText);
            setErrorMessage(`Download failed: ${errorText.substring(0, Math.min(errorText.length, 200))}... (See console for full error)`);
        } catch (readError) {
            console.warn('Could not read error response from download:', readError);
        }
        await FileSystem.deleteAsync(uri, { idempotent: true });
        return;
      }

      console.log('Finished downloading to:', uri);
      // Save the downloaded file to the device's media library
      const asset = await MediaLibrary.createAssetAsync(uri);
      console.log('Asset created:', asset);

      // Optional: Create an album to organize downloads
      const albumName = 'YouTubeDownloader';
      const album = await MediaLibrary.getAlbumAsync(albumName);
      if (album == null) {
        await MediaLibrary.createAlbumAsync(albumName, asset, false);
        console.log('Album created and asset added.');
      } else {
        await MediaLibrary.addAssetsToAlbumAsync([asset], album.id, false);
        console.log('Asset added to existing album.');
      }

      setErrorMessage(`Video "${videoInfo.title}" downloaded and saved successfully!`);
      setVideoInfo(null);
      setVideoUrl('');
      setDownloadProgress(0); // Reset progress after successful download

    } catch (error) {
      console.error('Error during download:', error);
      setErrorMessage(`Download failed: ${error.message}. Please check network connection and backend.`);
      if (error.message.includes("Could not connect to the server") || error.message.includes("Network request failed")) {
          setErrorMessage(`Network error during download. Is the backend running at ${BACKEND_URL} and accessible from your phone?`);
      }
    } finally {
      setIsLoading(false);
    }
  };


  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.headerText}>
          YouTube Video Downloader
        </Text>

        <View style={styles.inputCard}>
          <TextInput
            style={styles.textInput}
            placeholder="Enter YouTube Video URL"
            value={videoUrl}
            onChangeText={setVideoUrl}
            keyboardType="url"
            autoCapitalize="none"
          />
          <Button
            title={isLoading && !videoInfo ? 'Fetching Info...' : 'Get Video Info'}
            onPress={handleGetVideoInfo}
            disabled={isLoading}
            color="#4299E1" // Blue-500
          />
        </View>

        {errorMessage ? (
          <Text style={styles.errorMessage}>
            {errorMessage}
          </Text>
        ) : null}

        {isLoading && !videoInfo ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#4299E1" />
            <Text style={styles.loadingText}>Fetching video info...</Text>
          </View>
        ) : null}

        {videoInfo && (
          <View style={styles.videoInfoCard}>
            <Text style={styles.videoTitle}>
              {videoInfo.title}
            </Text>
            {videoInfo.thumbnail ? (
              <Image
                source={{ uri: videoInfo.thumbnail }}
                style={styles.thumbnailImage}
                resizeMode="cover"
              />
            ) : null}
            <Text style={styles.videoDetailText}>
              Duration: {videoInfo.duration}
            </Text>
            <Text style={styles.videoDetailText}>
              Available Qualities: {videoInfo.qualities.join(', ')}
            </Text>

            <Text style={styles.chooseQualityText}>
              Choose Quality to Download:
            </Text>
            {videoInfo.qualities.map((quality) => (
              <View key={quality} style={styles.downloadButtonContainer}>
                <Button
                  title={`Download ${quality}`}
                  onPress={() => handleDownloadVideo(quality)}
                  disabled={isLoading}
                  color="#38A169" // Green-600
                />
              </View>
            ))}

            {/* Display progress bar if downloading and progress is not 0 */}
            {isLoading && downloadProgress > 0 && downloadProgress < 100 && (
                <View style={styles.progressBarContainer}>
                    <View style={[styles.progressBar, { width: `${downloadProgress}%` }]} />
                    <Text style={styles.downloadProgressText}>Downloading: {downloadProgress}%</Text>
                </View>
            )}
            {/* Display "Download complete" or "Processing" messages */}
            {isLoading && downloadProgress === 100 && (
                <Text style={styles.downloadProgressText}>Processing on server...</Text>
            )}
            {!isLoading && downloadProgress === 100 && videoInfo === null && (
                <Text style={styles.downloadCompletedText}>Download Complete!</Text>
            )}

          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F7FAFC', // Tailwind 'gray-100'
  },
  container: {
    flexGrow: 1,
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#F7FAFC', // Tailwind 'gray-100'
  },
  headerText: {
    fontSize: 30,
    fontWeight: 'bold',
    marginBottom: 24,
    textAlign: 'center',
    color: '#1E40AF', // Tailwind 'blue-800'
  },
  inputCard: {
    width: '100%',
    marginBottom: 24,
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    elevation: 4, // Android shadow
    shadowColor: '#000', // iOS shadow
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  textInput: {
    borderWidth: 1,
    borderColor: '#D1D5DB', // Tailwind 'gray-300'
    padding: 12,
    marginBottom: 16,
    borderRadius: 6,
    fontSize: 16,
    width: '100%',
  },
  errorMessage: {
    color: '#DC2626', // Tailwind 'red-600'
    marginBottom: 16,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '600',
  },
  loadingContainer: {
    marginVertical: 16,
    alignItems: 'center',
  },
  loadingText: {
    color: '#374151', // Tailwind 'gray-700'
    marginTop: 8,
  },
  videoInfoCard: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    padding: 16, // Added padding here for better spacing inside the card
    marginBottom: 24,
  },
  videoTitle: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 12,
    color: '#1D4ED8', // Tailwind 'blue-700'
  },
  thumbnailImage: {
    width: '100%',
    height: 192,
    borderRadius: 8,
    marginBottom: 12,
  },
  videoDetailText: {
    color: '#374151', // Tailwind 'gray-700'
    marginBottom: 8,
    fontSize: 16,
  },
  chooseQualityText: {
    fontSize: 18,
    fontWeight: '500',
    marginBottom: 12,
    color: '#1F2937', // Tailwind 'gray-800'
    marginTop: 8,
  },
  downloadButtonContainer: {
    marginBottom: 8,
  },
  downloadProgressContainer: {
    marginTop: 16,
    alignItems: 'center',
  },
  downloadProgressText: {
    color: '#374151',
    fontSize: 16,
    marginTop: 8, // Added margin for spacing
  },
  progressBarContainer: {
    width: '100%',
    height: 10,
    backgroundColor: '#E5E7EB', // Gray-200
    borderRadius: 5,
    overflow: 'hidden', // Ensures progress bar stays within bounds
    marginVertical: 10,
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#3B82F6', // Blue-500
    borderRadius: 5,
  },
  downloadCompletedText: {
    color: '#10B981', // Green-500
    fontSize: 16,
    fontWeight: 'bold',
    marginTop: 16,
  },
});

export default App;
