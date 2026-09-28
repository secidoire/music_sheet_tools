# Functions exported by our OpenCV.js build (scripts/build-opencv.sh): only what src/ calls.
# Mat, Size, Scalar, matFromArray and the constants come with the core bindings.
# Read by OpenCV's embindgen.py, which provides makeWhiteList.

core = {
    '': ['bitwise_and', 'rotate'],
}

imgproc = {
    '': [
        'adaptiveThreshold',
        'connectedComponentsWithStats',
        'dilate',
        'GaussianBlur',
        'getRotationMatrix2D',
        'getStructuringElement',
        'HoughLinesP',
        'morphologyEx',
        'resize',
        'threshold',
        'warpAffine',
    ],
}

white_list = makeWhiteList([core, imgproc])  # noqa: F821
