import React, { useState, useEffect } from 'react';
import { getContent, getPlatformStatus } from '../../services/contentService';
import { type TutorialContent, type PlatformStatus, type PlatformSystemStatus, type User, type Language } from '../../types';
import { ChevronDownIcon, CheckCircleIcon, XIcon, AlertTriangleIcon, ImageIcon } from '../Icons';

interface PlatformUpdatesViewProps {
}

const PlatformUpdatesView: React.FC<PlatformUpdatesViewProps> = () => {
    const [status, setStatus] = useState<PlatformStatus | null>(null);

    useEffect(() => {
        const fetchUpdates = async () => {
            const statusData = await getPlatformStatus();
            setStatus(statusData);
        };
        fetchUpdates();
    }, []);

    const getStatusIndicator = (systemStatus: PlatformSystemStatus) => {
        switch (systemStatus) {
            case 'operational':
                return { Icon: CheckCircleIcon, color: 'text-green-500', text: "All Systems Operational" };
            case 'degraded':
                return { Icon: AlertTriangleIcon, color: 'text-yellow-500', text: "Degraded Performance" };
            case 'outage':
                return { Icon: XIcon, color: 'text-red-500', text: "Major Outage" };
        }
    };

    if (!status) {
        return null;
    }

    const { Icon, color, text } = getStatusIndicator(status.status);

    return (
        <div className="bg-white dark:bg-neutral-900 p-6 rounded-lg shadow-sm h-full flex flex-col">
            <h2 className="text-xl font-bold mb-4 flex-shrink-0">Platform Updates</h2>
            
            <div className="mb-6 p-4 bg-neutral-100 dark:bg-neutral-800/50 rounded-lg flex-shrink-0">
                <div className="flex items-center gap-3">
                    <Icon className={`w-6 h-6 ${color}`} />
                    <div>
                        <p className={`font-semibold ${color}`}>{text}</p>
                        <p className="text-sm text-neutral-600 dark:text-neutral-400">{status.message}</p>
                    </div>
                </div>
                <p className="text-right text-xs text-neutral-500 dark:text-neutral-500 mt-2">
                    Last Updated: {new Date(status.lastUpdated).toLocaleString()}
                </p>
            </div>
        </div>
    );
};

interface ECourseViewProps {
    currentUser: User;
    language: Language;
}

const ECourseView: React.FC<ECourseViewProps> = ({ currentUser }) => {
  const [content, setContent] = useState<TutorialContent | null>(null);
  const [isTutorialsVisible, setIsTutorialsVisible] = useState(false);

  useEffect(() => {
    const fetchPageData = async () => {
        const contentData = await getContent();
        setContent(contentData);
    };
    fetchPageData();
  }, []);

  if (!content) {
    return <div className="text-center p-10">Loading tutorial content...</div>;
  }

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        <div className="bg-white dark:bg-neutral-900 p-6 rounded-lg shadow-sm">
            <h2 className="text-xl font-bold mb-4">Getting Started</h2>
            <div className="aspect-video mb-4">
              <iframe 
                className="w-full h-full rounded-md"
                src={content.mainVideoUrl}
                title="YouTube video player" 
                frameBorder="0" 
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                allowFullScreen>
              </iframe>
            </div>
            <div className="space-y-3">
              <h3 className="text-lg font-bold">{content.mainTitle}</h3>
              <p className="text-sm text-neutral-600 dark:text-neutral-300">{content.mainDescription}</p>
            </div>
        </div>
        <PlatformUpdatesView />
      </div>


      {content.tutorials.length > 0 && (
        <div>
          <div 
            onClick={() => setIsTutorialsVisible(!isTutorialsVisible)}
            className="flex justify-between items-center cursor-pointer group"
            aria-expanded={isTutorialsVisible}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setIsTutorialsVisible(!isTutorialsVisible) }}
          >
            <h2 className="text-2xl font-bold border-l-4 border-primary-500 pl-4 group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">Video Tutorials</h2>
            <ChevronDownIcon className={`w-6 h-6 text-neutral-500 group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-transform duration-300 ${isTutorialsVisible ? 'rotate-180' : ''}`} />
          </div>
          
          <div className={`grid overflow-hidden transition-all duration-500 ease-in-out ${isTutorialsVisible ? 'grid-rows-[1fr] opacity-100 mt-6' : 'grid-rows-[0fr] opacity-0 mt-0'}`}>
              <div className="overflow-hidden">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {content.tutorials.map((tutorial, index) => (
                      <div key={index} className="bg-white dark:bg-neutral-900 rounded-lg p-5 flex flex-col shadow-sm">
                        <div className="flex-1">
                          <div className="aspect-video bg-neutral-200 dark:bg-neutral-800 rounded-md mb-4 flex items-center justify-center font-semibold text-neutral-500 overflow-hidden">
                            {tutorial.thumbnailUrl ? (
                              <img src={tutorial.thumbnailUrl} alt={tutorial.title} className="w-full h-full object-cover" />
                            ) : (
                              <span>Tutorial {index + 1}</span>
                            )}
                          </div>
                          <h3 className="font-bold text-lg mb-2">{tutorial.title}</h3>
                          <p className="text-sm text-neutral-600 dark:text-neutral-400">{tutorial.description}</p>
                        </div>
                        <a href="#" className="text-primary-600 dark:text-primary-400 font-semibold mt-4 text-sm hover:underline">Learn more...</a>
                      </div>
                    ))}
                  </div>
              </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ECourseView;